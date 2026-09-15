# Metadata 1: the rules

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a component's metadata a thing the product can reason about: fields, metadata schemas
and component types as versioned, migrated definitions; the effective fields a component type
resolves to; every validation failure named; values carried into the next version without ever
changing one that is present; and the canonical form those values take in the version digest.

**Architecture:** Everything lands in `packages/domain/src/metadata/`, beside the content model, as
pure functions over definition payloads the caller hands in - no database, no network, no clock. The
content model's canonical serialisation and migration chain move to `packages/domain/src/stored/` first,
so definitions and values reuse them rather than copying them. Lexical forms, then field definitions,
then `checkValue`, then schemas and types, then fixtures, then resolution, assignment checks,
validation, user values, carrying forward, and what a version records - each one task, each test first.

**Tech Stack:** TypeScript strict (with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`),
zod 4, Vitest 5. No new dependency.

**Spec:** [`../design/metadata.md`](../design/metadata.md), including its Review section, whose
decisions are settled, and its revision on `claude/access-design` (2da561b): resolution checks every
effective default against the field version it is given, and MET-037 is added and left unclaimed.
Read with
[ADR-0024](../decisions/0024-a-version-digest-over-the-whole-version.md) (what values and
`notCarried` feed), [storage-and-versioning.md](../design/storage-and-versioning.md) (where they are
stored) and [component-editor.md](../design/component-editor.md), "Metadata alongside" (how callers use
these functions).

First of the metadata plans. This one is the rules and nothing else: no table, no migration of a
database, no route, no editor panel, no definitions-management service. Those have their own plans,
written when their turn comes.

**The code below was run before the plan was committed.** Against `main` at 0.18.3, every block was
applied in task order and the domain suite passed (259 tests), with `tsc`, ESLint, Prettier and
`pnpm trace check` clean and the citation counts each task names measured rather than estimated. Then
it was removed, so the plan's tasks can be executed test first. It is still worth watching each test
fail: the run proves the code, not that the order of an executor's steps did.

## Global Constraints

Every task's requirements include these.

- **Test-driven, and the failing run is watched.** No production code without a test that preceded it
  and was seen to fail. A test that passes before the implementation exists is testing nothing.
- **Name the requirement in the `describe` or `it` title**, as `it('MET-007 applies a field reached
through two schemas once', ...)`. `packages/trace` scans titles to compute `Covered`; an identifier in
  a comment is a mention, not a citation.
- **Cite only what the design owns, and only what the test demonstrates.** metadata.md owns MET-001,
  002, 004 to 007, 009, 010, 013, 017, 018, 022, 028, 030 and 036. A test about something the design
  leaves unclaimed - MET-008's refusal, MET-029's display, MET-033's refusal of a write, MET-037's
  refusal of a field version - carries no identifier in its title. `pnpm trace check` fails on a citation of a requirement no design claims.
- **`packages/domain` stays platform-free.** No React, no Electron, no `fs`, no `window`, no
  `node:crypto`, no clock, no I/O. Tests may read fixtures with `node:fs`; production code may not.
- **`pattern` does not ship.** metadata.md's first open question - how a pattern is kept from
  backtracking exponentially - is unanswered, and the design says `pattern` does not ship until it is.
  The field definition schema refuses a `pattern` member, and a test says so.
- **No em or en dashes in user-facing text.** A failure's `detail` and an error's message reach an
  author; they use a plain hyphen. Code comments are exempt.
- **A passing run has no errors or warnings.** Pristine output is a gate, not a preference.
- **Prettier, printWidth 100.** `pnpm exec prettier --write` on what you changed, then `pnpm format`.
- **One pull request, one version bump, one changelog entry**, in the last task. Never commit to `main`.
- **No real data anywhere.** Names in fixtures and tests are invented: `Ada`, `Grace`, `Alice`, `Leeds`.
- **The corpus is queried, never read wholesale.** `pnpm trace show MET-0NN` for any requirement named
  here.
- **The root `pnpm test` needs the object store and the database.** Start them once per session:
  `docker compose -f deploy/compose.yaml up -d --wait postgres seaweedfs`. The domain suite alone
  (`pnpm --filter @alloy-works/domain test`) needs neither.
- **`trace.json` is drift-checked, and the citation count is pinned.**
  `packages/trace/src/trace.test.ts` compares the committed `packages/trace/trace.json` with a fresh
  compile, and pins the number of citations. Every task that adds a cited test title regenerates
  `trace.json` and moves the pin in the same commit, so every commit is green. The numbers each task
  gives were measured against `main` at 0.18.3 (61 citations before this plan); if `main` has moved,
  set the pin to what the regenerated file holds and say so in the commit.

---

## Decisions taken before this plan was written

metadata.md settles the rules. It leaves some shapes to the plan, and a reviewer should be able to
reject each of these on its own, so they are stated rather than buried in code.

**1. The canonical rules and the migration chain move to `packages/domain/src/stored/`, and the content
model calls them.** The design says values are serialised "by the content model's canonical rules" and
definitions migrate "by the same harness the content model uses". Both exist, but both are hard-wired to
content: `migrate` reads content's `CURRENT_SCHEMA_VERSION`, and `canonicalise` sorts **any** array
under a member named `marks`, because in content that member is a set. Reused as it stands, it would
sort the values of a metadata field whose identifier happens to be `marks`, and MET-030 makes their
order part of the value. So task 1 extracts both, parameterised: `canonicalJson(value, order?)` keeps
every array's order unless the caller names a member as a set, and `migrateStored(value, chain)` takes
the chain. Content's behaviour and its tests do not change.

**2. One definition schema version across the three kinds.** Every field, schema and type payload
records `schemaVersion`, against one `DEFINITION_SCHEMA_VERSION`. A version that changes one kind gives
the others an identity step. So a fixture directory is one version of all three, `fixtures/v1/` holds
`fields.json`, `metadata-schemas.json` and `component-types.json` - each a list of payloads of that
kind - and it is never deleted.

**3. A number is valid only in canonical form.** The design says the string is "canonicalised (no
leading zeros, no trailing fractional zeros)" without saying who canonicalises. If validation accepted
`1.50` and `1.5` as one value, they would be two values in the digest and in duplicate detection. So
`checkValue` fails `metadata.type` for a non-canonical decimal, and `canonicaliseDecimal` is exported
for the editor and any import to apply before a value is stored. It never rounds.

**4. "No duplicate after normalisation" (MET-030) compares what a value means.** Text after NFC, a time
as `HH:MM:SS`, a date and time as its instant (so one instant at two offsets is one value), a user by
principal identifier. Text is not refused for being un-normalised, since the canonical form normalises
it on the way into the digest as content's does; lengths are counted in code points of the NFC form.

**5. Three definition rules the design implies but does not state.** A schema groups a field once. A
type assigns a schema once, and one assignment requires a field once. And **a default is a value, not a
clear**: a default of `null` or `[]` would satisfy "a fixed entry must have a default" while fixing
nothing, and carrying forward would write a clear nobody made into a field with no member - which is
exactly the distinction the Review's third point exists to keep.

**6. Shapes the design names but does not draw.**

| Name                            | Shape chosen                                                                                                                                                                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A failure                       | `{ code: 'metadata.<rule>', field, rule, schemas, detail }`. Validation's rules, plus `user`, and three definition rules - `default`, `requires`, `defaultConflict` - found by `checkSchema` and `checkAssignment`                                                                   |
| An effective field              | `{ field, required, requiredBy, fixed, fixedBy, default?: { value, from } }`. The design's `order` is the returned array's order rather than a member                                                                                                                                |
| `checkAssignment`               | `(assigned: MetadataSchemaDefinition[], candidate: { assignment, schema })` - it needs the candidate schema's payload to see what it groups                                                                                                                                          |
| `checkUserValues`               | `principals` is a **synchronous** `(id) => { active } \| undefined`. The package does no I/O, so the service collects identifiers with `principalIdsIn`, loads them in one query, and passes a lookup over what it loaded                                                            |
| `notCarried`                    | A list of `{ field, value }`, sorted by field identifier - "a list ... by field", in the order canonical serialisation sorts members                                                                                                                                                 |
| `definitionsFor`                | `(type, schemas, fields)`, each `{ version, definition }`: a payload does not know its own version, which is the artifact row's. Returns `{ kind, id, version }[]` sorted by kind, identifier and version, because a version's definitions are a set (ADR-0024)                      |
| A default resolution cannot use | `resolveComponentFields` throws `DefinitionConflictError`, carrying `field`, `schemas` and `rule`, never a validation failure. `rule` is `defaultConflict` for disagreeing defaults, and the refusing rule - `maxLength`, `type` and so on - for a default its field version refuses |
| A missing definition            | Resolution, `checkSchema` and `definitionsFor` throw, naming what was not supplied. Being handed a type without its schemas is the caller's bug, not an author's failure                                                                                                             |

**7. A hand-written generator for the property test, not `fast-check`.** No workspace depends on a
property-testing library. The property metadata.md names - every value but a clear is carried or
recorded exactly once, and every carried value is the very same value - is a partition that needs no
shrinking to diagnose: a failing case prints its seed and its whole input. A seeded generator
(mulberry32) runs the same thousand cases on Windows and on Linux, and adds nothing to the lock file.
It is in the spirit of CLAUDE.md's preference for a hand-written fake over a mocking library.

**8. The canonical form of values and of `notCarried` is here; the version record's is not.** ADR-0024
says the package owes a serialisation of the whole version - content, component type, values,
definitions and `notCarried`. metadata.md owns only the metadata parts, and the record's other members
are storage-and-versioning.md's to shape. So this plan provides `canonicaliseValues`,
`canonicaliseNotCarried` and a sorted `definitionsFor`, and the storage plan composes them.

---

## Files

| File                                               | Responsibility                                                                                      |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `packages/domain/src/stored/canonical.ts`          | `canonicalJson`: the canonical rules, with an optional hook naming a member's array as a set        |
| `packages/domain/src/stored/migrate.ts`            | `migrateStored`: the read-time migration chain, parameterised by subject, current version and steps |
| `packages/domain/src/content/model/canonical.ts`   | Modified: `canonicalise` calls `canonicalJson` with `marks` named as a set                          |
| `packages/domain/src/content/model/migrate.ts`     | Modified: `migrate` calls `migrateStored` with content's chain                                      |
| `packages/domain/src/metadata/lexical.ts`          | Decimal, date, time and date-and-time forms, and exact comparison. No `Date`, no float              |
| `packages/domain/src/metadata/definition.ts`       | `DEFINITION_SCHEMA_VERSION` and the members every definition carries                                |
| `packages/domain/src/metadata/field.ts`            | The closed data types and the field definition schema                                               |
| `packages/domain/src/metadata/failure.ts`          | The failure shape and its constructor                                                               |
| `packages/domain/src/metadata/values.ts`           | The values type, and what no member, a clear, a user value and one value mean                       |
| `packages/domain/src/metadata/check-value.ts`      | `checkValue(field, value)`                                                                          |
| `packages/domain/src/metadata/schema.ts`           | The metadata schema definition and `checkSchema`                                                    |
| `packages/domain/src/metadata/component-type.ts`   | The component type definition and its assignments                                                   |
| `packages/domain/src/metadata/migrate.ts`          | `migrateDefinition` and `readDefinition`, per kind                                                  |
| `packages/domain/src/metadata/fixtures/v1/*.json`  | Stored definitions at definition schema version 1, never deleted                                    |
| `packages/domain/src/metadata/resolve.ts`          | `resolveComponentFields` and `DefinitionConflictError`                                              |
| `packages/domain/src/metadata/check-assignment.ts` | `checkAssignment`                                                                                   |
| `packages/domain/src/metadata/validate.ts`         | `validate(effective, values)`                                                                       |
| `packages/domain/src/metadata/users.ts`            | `checkUserValues` and `principalIdsIn`                                                              |
| `packages/domain/src/metadata/carry.ts`            | `carryForward(values, effective)`                                                                   |
| `packages/domain/src/metadata/record.ts`           | `definitionsFor`, `canonicaliseValues`, `canonicaliseNotCarried`                                    |
| `packages/domain/src/metadata/index.ts`            | The barrel, re-exported from `packages/domain/src/index.ts`                                         |

Each production file has a `.test.ts` beside it. Test helpers that build definitions are repeated in
each test file on purpose: a helper module would be compiled into `dist/`, and each is a few lines.

## How the verification section becomes tests

| metadata.md, Verification                              | Where                                                                                                                                                                                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every validation rule has a test that fails without it | `required`, `fixed`: task 9. `type`, `multiplicity`, `maxValues`, `minLength`, `maxLength`, `min`, `max`, `integer`, `scale`: task 4. Each asserts the exact list of codes and a passing twin, so removing a rule fails its test |
| A fixture per definition schema version                | Task 6, with a test that every data type, multiplicity and validation member appears in `fields.json`                                                                                                                            |
| Resolution over a matrix                               | Task 7: 400 cases, two schemas sharing a field, every combination of required, fixed, default and an assignment's `requires`                                                                                                     |
| A default its field refuses                            | Task 7: a default fixed by two schemas throws under a later field version, naming the field, both schemas and the rule, and resolves under the version it was saved against                                                      |
| A property test for `carryForward`                     | Task 11: 1,000 seeded cases                                                                                                                                                                                                      |
| Clears survive                                         | Task 11                                                                                                                                                                                                                          |
| Nothing present is replaced                            | Task 11, with `validate` naming every schema that fixes the field                                                                                                                                                                |
| Assignments                                            | Task 8 (`checkAssignment` refuses a stray) and task 7 (resolution with a stray equals resolution without); task 9 (named by the schema assigned)                                                                                 |
| User values                                            | Task 10                                                                                                                                                                                                                          |
| Numbers                                                | Tasks 2, 4 and 12: decimal strings a float would corrupt, compared exactly and round-tripped through the canonical form                                                                                                          |

## Requirements and the tasks that cite them

| ID      | Tasks          | ID      | Tasks             |
| ------- | -------------- | ------- | ----------------- |
| MET-001 | 3              | MET-013 | 7                 |
| MET-002 | 2, 3, 4, 6, 12 | MET-017 | 6, 7, 9, 12       |
| MET-004 | 3, 4, 9, 10    | MET-018 | 12                |
| MET-005 | 5              | MET-022 | 4, 5, 9, 10       |
| MET-006 | 5, 6, 7, 9, 11 | MET-028 | 2, 3, 4           |
| MET-007 | 7              | MET-030 | 1, 3, 4, 5, 9, 12 |
| MET-009 | 5, 7, 8, 9     | MET-036 | 9, 10, 11, 12     |
| MET-010 | 5, 6, 7        |         |                   |

Task 7's default check is cited as MET-006 (a schema declares a default, and resolution throws on one
its field refuses) and MET-017 (the same default resolves under the field version it was saved
against). **MET-037 is cited by no task**: it is the refusal of the field version itself, which
metadata.md leaves to the undesigned definitions-management service. Citing it would also fail
`pnpm trace check` as `cited-undesigned`.

---

## Task 1: The canonical rules and the migration chain, shared

**Files:**

- Create: `packages/domain/src/stored/canonical.ts`, `packages/domain/src/stored/migrate.ts`
- Modify: `packages/domain/src/content/model/canonical.ts`, `packages/domain/src/content/model/migrate.ts`
- Modify: `packages/trace/src/trace.test.ts` (the citation pin), `packages/trace/trace.json` (regenerated)
- Test: `packages/domain/src/stored/canonical.test.ts`, `packages/domain/src/stored/migrate.test.ts`

**Interfaces:**

- Consumes: nothing new
- Produces: `canonicalJson(value: unknown, order?: ArrayOrder): string`,
  `type ArrayOrder = (member: string, array: readonly unknown[]) => readonly unknown[]`,
  `migrateStored(value: unknown, chain: MigrationChain): Record<string, unknown>`,
  `type Migration`, `type MigrationChain = { subject; current; migrations }`. Content's `canonicalise`,
  `migrate` and `readContent` keep their signatures and behaviour.

See decision 1 for why. The existing content model tests are the regression check for the second half
of this task: they must pass unchanged.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/domain/src/stored/canonical.test.ts
import { describe, expect, it } from 'vitest';

import { canonicalJson } from './canonical.js';

describe('the canonical rules every stored payload takes', () => {
  it('CNT-011 orders members lexicographically, at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: true, c: null } })).toBe(
      '{"a":{"c":null,"d":true},"b":1}',
    );
  });

  it('CNT-056 emits strings in NFC', () => {
    expect(canonicalJson('cafe\u0301')).toBe(canonicalJson('caf\u00e9'));
  });

  it('CNT-011 emits no insignificant whitespace, and omits a member holding undefined', () => {
    expect(canonicalJson({ a: [1, 2], b: undefined })).toBe('{"a":[1,2]}');
  });

  it('MET-030 keeps every array in the order given, even under a member named marks', () => {
    expect(canonicalJson({ marks: ['b', 'a'] })).toBe('{"marks":["b","a"]}');
  });

  it('CNT-011 reorders an array only where the caller names its member as a set', () => {
    const sorted = (member: string, array: readonly unknown[]) =>
      member === 'tags' ? [...(array as string[])].sort() : array;
    expect(canonicalJson({ tags: ['b', 'a'], list: ['b', 'a'] }, sorted)).toBe(
      '{"list":["b","a"],"tags":["a","b"]}',
    );
  });
});
```

```ts
// packages/domain/src/stored/migrate.test.ts
import { describe, expect, it } from 'vitest';

import { migrateStored, type MigrationChain } from './migrate.js';

const chain: MigrationChain = {
  subject: 'widget',
  current: 3,
  migrations: {
    1: (value) => ({ ...value, steps: ['1to2'] }),
    2: (value) => ({ ...value, steps: [...(value.steps as string[]), '2to3'] }),
  },
};

describe('the migration chain every stored payload takes', () => {
  it('CNT-012 applies every step from the recorded version to the current one, in order', () => {
    expect(migrateStored({ schemaVersion: 1 }, chain)).toEqual({
      schemaVersion: 3,
      steps: ['1to2', '2to3'],
    });
  });

  it('CNT-012 applies no step to a payload already at the current version', () => {
    expect(migrateStored({ schemaVersion: 3, steps: [] }, chain)).toEqual({
      schemaVersion: 3,
      steps: [],
    });
  });

  it('CNT-012 projects rather than rewrites, so the stored value is untouched', () => {
    const stored = { schemaVersion: 1 };
    migrateStored(stored, chain);
    expect(stored).toEqual({ schemaVersion: 1 });
  });

  it('CNT-012 names the step that is missing', () => {
    expect(() =>
      migrateStored({ schemaVersion: 1 }, { ...chain, migrations: { 1: chain.migrations[1]! } }),
    ).toThrow(/widget from schema version 2 to 3/);
  });

  it('CNT-011 refuses a payload that records no schema version, naming its subject', () => {
    expect(() => migrateStored({}, chain)).toThrow(/widget records no schema version/);
  });

  it('CNT-012 refuses a version newer than this build, by number', () => {
    expect(() => migrateStored({ schemaVersion: 4 }, chain)).toThrow(/4/);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @alloy-works/domain test -- src/stored`
Expected: FAIL, both files: the imports `./canonical.js` and `./migrate.js` do not resolve.

- [ ] **Step 3: Write the minimal implementation**

```ts
// packages/domain/src/stored/canonical.ts
/**
 * The canonical serialisation every stored payload in this package takes, and the input to any hash
 * or digest over it (ADR-0024).
 *
 * Three rules, and no more: members in lexicographic order, strings in NFC, no insignificant
 * whitespace. **Arrays keep their order** unless the caller names a member whose array is a set - the
 * content model's `marks`, which CNT-003 makes a set. The rule is the caller's rather than this
 * module's because a member name means nothing here: a metadata field whose identifier happens to be
 * `marks` holds a list whose order is part of its value (MET-030), and a rule keyed on the name alone
 * would sort it.
 */
export type ArrayOrder = (member: string, array: readonly unknown[]) => readonly unknown[];

export function canonicalJson(value: unknown, order?: ArrayOrder): string {
  return emit(value, order);
}

function emit(value: unknown, order: ArrayOrder | undefined): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
  if (Array.isArray(value)) return `[${value.map((member) => emit(member, order)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, member]) => member !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([key, member]) => {
        const ordered = order && Array.isArray(member) ? order(key, member) : member;
        return `${JSON.stringify(key)}:${emit(ordered, order)}`;
      })
      .join(',')}}`;
  }
  throw new Error(`Cannot canonicalise a value of type ${typeof value}`);
}
```

```ts
// packages/domain/src/stored/migrate.ts
/**
 * A migration from one schema version to the next. Total and pure: it takes whatever was stored at
 * `from` and returns whatever `from + 1` expects, and it reads nothing outside its argument.
 */
export type Migration = (value: Record<string, unknown>) => Record<string, unknown>;

/** One kind of stored payload's chain: what it is called in an error, where it stands, its steps. */
export type MigrationChain = {
  readonly subject: string;
  readonly current: number;
  readonly migrations: Readonly<Record<number, Migration>>;
};

/**
 * Migration is a READ-TIME PROJECTION, never a rewrite. Version rows take inserts only and each
 * digest is over what was written, so migrating a stored payload would either invalidate its digest
 * or need a version row nobody authored. The stored bytes never change, and neither does the argument.
 */
export function migrateStored(value: unknown, chain: MigrationChain): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || !('schemaVersion' in value)) {
    throw new Error(`Stored ${chain.subject} records no schema version, so it cannot be migrated`);
  }
  const record = { ...(value as Record<string, unknown>) };
  const from = record.schemaVersion;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 1) {
    throw new Error(
      `Stored ${chain.subject} records a schema version that is not a version: ${String(from)}`,
    );
  }
  if (from > chain.current) {
    throw new Error(
      `Stored ${chain.subject} was written against schema version ${from}, which is newer than this build's ${chain.current}`,
    );
  }

  let migrated = record;
  for (let version = from; version < chain.current; version += 1) {
    const step = chain.migrations[version];
    if (!step) {
      throw new Error(
        `No migration for ${chain.subject} from schema version ${version} to ${version + 1}`,
      );
    }
    migrated = { ...step(migrated), schemaVersion: version + 1 };
  }
  return migrated;
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm --filter @alloy-works/domain test -- src/stored`
Expected: PASS, 11 tests.

- [ ] **Step 5: Point the content model at the shared rules**

Replace `packages/domain/src/content/model/canonical.ts` with:

```ts
import { canonicalJson } from '../../stored/canonical.js';

import type { ContentDocument } from './document.js';

/**
 * The canonical serialisation of content, and the input to `content_hash`.
 *
 * `content_hash` keys derived data, and the version digest (ADR-0024) - which decides whether a
 * version changed - applies these same rules to the whole version, content included. Both rest on two
 * identical documents producing one string.
 *
 * Three rules, and no more: members in lexicographic order (a declared order that needs no table to
 * keep in step with the schema), strings in NFC (CNT-056), and no insignificant whitespace.
 *
 * Marks are a set rather than a sequence (CNT-003), so they sort too - by type then identifier, which
 * is total because an identifier is unique.
 *
 * This returns a string rather than a hash on purpose: hashing needs `node:crypto`, which is not
 * platform-free, or `crypto.subtle`, which would make parsing async for no gain. The caller hashes.
 */
export function canonicalise(document: ContentDocument): string {
  return canonicalJson(document, marksAsASet);
}

function marksAsASet(member: string, array: readonly unknown[]): readonly unknown[] {
  if (member !== 'marks') return array;
  return [...(array as { type: string; id: string }[])].sort((a, b) =>
    a.type === b.type ? (a.id < b.id ? -1 : 1) : a.type < b.type ? -1 : 1,
  );
}
```

Replace `packages/domain/src/content/model/migrate.ts` with:

```ts
import { migrateStored, type MigrationChain } from '../../stored/migrate.js';

import { CURRENT_SCHEMA_VERSION, parseContentDocument, type ContentDocument } from './document.js';

/**
 * Empty while there is one schema version. It exists now rather than when it is needed, because the
 * first schema change is the moment a chain nobody built is discovered to be missing - and by then
 * there is stored content that needs it.
 */
const chain: MigrationChain = {
  subject: 'content',
  current: CURRENT_SCHEMA_VERSION,
  migrations: {},
};

/** Content's chain, through the harness every stored payload in this package shares. */
export function migrate(value: unknown): unknown {
  return migrateStored(value, chain);
}

export type ReadOutcome =
  | { ok: true; document: ContentDocument }
  | { ok: false; artifact: string; version: string; failure: string };

/**
 * CNT-013: content that fails validation on read-back is quarantined and reported, never silently
 * coerced or partially loaded. A typed outcome rather than an exception, so there is no path that
 * yields half a document - a generic error swallowed by a handler is the coercion CNT-013 forbids
 * with extra steps.
 */
export function readContent(
  value: unknown,
  context: { artifact: string; version: string },
): ReadOutcome {
  try {
    return { ok: true, document: parseContentDocument(migrate(value)) };
  } catch (error) {
    return {
      ok: false,
      artifact: context.artifact,
      version: context.version,
      failure: error instanceof Error ? error.message : String(error),
    };
  }
}
```

The one message that changes is content's "records no schema version" error, which loses its
`(CNT-011)` suffix; `migrate.test.ts` matches `/schema version/i`, so it still passes.

- [ ] **Step 6: Run the content model's tests unchanged**

Run: `pnpm --filter @alloy-works/domain test -- src/content`
Expected: PASS, every test that passed before this task, with no test file edited.

- [ ] **Step 7: Regenerate the trace and move the citation pin**

Run: `pnpm --filter @alloy-works/trace generate`

In `packages/trace/src/trace.test.ts`, in `cites exactly as many times as the corpus currently does`:

```ts
expect(model.citations).toHaveLength(66);
```

(from 61: the two new files cite CNT-011, CNT-056 and MET-030, and CNT-011 and CNT-012.)

- [ ] **Step 8: Run the gate**

```bash
docker compose -f deploy/compose.yaml up -d --wait postgres seaweedfs
pnpm test && pnpm typecheck && pnpm lint && pnpm format
```

Expected: every suite passes with no warnings; `pnpm lint` and `pnpm format` report nothing.

- [ ] **Step 9: Commit**

```bash
git add packages/domain/src/stored packages/domain/src/content/model/canonical.ts packages/domain/src/content/model/migrate.ts packages/trace/trace.json packages/trace/src/trace.test.ts
git commit -m "Share the canonical rules and the migration chain across stored payloads"
```

---

## Task 2: The lexical forms of values

**Files:**

- Create: `packages/domain/src/metadata/lexical.ts`
- Modify: `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`
- Test: `packages/domain/src/metadata/lexical.test.ts`

**Interfaces:**

- Consumes: nothing
- Produces: `isCanonicalDecimal(value: string): boolean`,
  `canonicaliseDecimal(input: string): string | undefined`, `compareDecimal(a: string, b: string): number`,
  `decimalScale(value: string): number`, `isIsoDate(value: string): boolean`,
  `isIsoTime(value: string): boolean`, `timeKey(value: string): string`,
  `dateTimeInstant(value: string): bigint | undefined`

A number is a string because a JSON number is a binary float by the time a parser is done with it
(metadata.md, "A number is a string"). Dates go through integer arithmetic rather than `Date`, whose
parsing varies by engine and whose years 0 to 99 mean 1900 to 1999.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/metadata/lexical.test.ts
import { describe, expect, it } from 'vitest';

import {
  canonicaliseDecimal,
  compareDecimal,
  dateTimeInstant,
  decimalScale,
  isCanonicalDecimal,
  isIsoDate,
  isIsoTime,
  timeKey,
} from './lexical.js';

describe('the lexical forms of metadata values', () => {
  it('MET-002 holds a number as a canonical decimal string, never a JSON number', () => {
    for (const value of ['0', '7', '-7', '0.1', '-0.25', '120', '9007199254740993']) {
      expect(isCanonicalDecimal(value), value).toBe(true);
    }
    for (const value of ['', '-0', '007', '1.50', '.5', '5.', '1e3', '+1', ' 1', '0x10']) {
      expect(isCanonicalDecimal(value), value).toBe(false);
    }
  });

  it('MET-002 canonicalises a number as entered without changing its value', () => {
    expect(canonicaliseDecimal('007.50')).toBe('7.5');
    expect(canonicaliseDecimal('-0.000')).toBe('0');
    expect(canonicaliseDecimal('.5')).toBe('0.5');
    expect(canonicaliseDecimal('+12.')).toBe('12');
    expect(canonicaliseDecimal('9007199254740993.10')).toBe('9007199254740993.1');
    expect(canonicaliseDecimal('1e3')).toBeUndefined();
    expect(canonicaliseDecimal('.')).toBeUndefined();
  });

  it('MET-002 compares decimals exactly, beyond what a float can hold', () => {
    expect(compareDecimal('9007199254740993', '9007199254740992')).toBeGreaterThan(0);
    expect(compareDecimal('0.1', '0.10000000000000001')).toBeLessThan(0);
    expect(compareDecimal('-2', '-10')).toBeGreaterThan(0);
    expect(compareDecimal('-0.5', '0.5')).toBeLessThan(0);
    expect(compareDecimal('12.5', '12.5')).toBe(0);
    expect(decimalScale('12.345')).toBe(3);
    expect(decimalScale('12')).toBe(0);
  });

  it('MET-028 refuses a date or a time carrying an offset', () => {
    expect(isIsoDate('2026-09-15')).toBe(true);
    expect(isIsoDate('2026-09-15Z')).toBe(false);
    expect(isIsoDate('2026-09-15+01:00')).toBe(false);
    expect(isIsoTime('09:30')).toBe(true);
    expect(isIsoTime('09:30:15')).toBe(true);
    expect(isIsoTime('09:30Z')).toBe(false);
    expect(isIsoTime('09:30:15+01:00')).toBe(false);
  });

  it('MET-002 refuses a date that is not a calendar day, and a time that is not a time of day', () => {
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('1900-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('0000-01-01')).toBe(false);
    expect(isIsoTime('24:00')).toBe(false);
    expect(isIsoTime('09:60')).toBe(false);
    expect(timeKey('09:00')).toBe(timeKey('09:00:00'));
  });

  it('MET-028 requires an offset or Z on a date and time, and reads it as one instant', () => {
    expect(dateTimeInstant('1970-01-01T00:00Z')).toBe(0n);
    expect(dateTimeInstant('2026-09-15T10:00+01:00')).toBe(dateTimeInstant('2026-09-15T09:00Z'));
    expect(dateTimeInstant('2026-09-15T09:00:00.5Z')).toBe(
      (dateTimeInstant('2026-09-15T09:00Z') ?? 0n) + 500_000_000n,
    );
    expect(dateTimeInstant('2026-09-15T09:00')).toBeUndefined();
    expect(dateTimeInstant('2026-02-30T09:00Z')).toBeUndefined();
    expect(dateTimeInstant('2026-09-15 09:00Z')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain test -- src/metadata/lexical`
Expected: FAIL, the import `./lexical.js` does not resolve.

- [ ] **Step 3: Write the minimal implementation**

```ts
// packages/domain/src/metadata/lexical.ts
/**
 * The lexical forms a metadata value takes in JSON, and how two of them compare. Pure string and
 * integer arithmetic: no `Date`, whose parsing differs by engine and whose years 0 to 99 mean 1900
 * to 1999, and no JSON number, which is a binary float by the time a parser is done with it.
 */

/**
 * A decimal in canonical form: an optional minus, no leading zeros, no trailing fractional zeros, no
 * exponent, and no negative zero. `0.1` is exactly the string entered, which a float cannot promise.
 */
const CANONICAL_DECIMAL = /^-?(0|[1-9]\d*)(\.\d*[1-9])?$/;

export function isCanonicalDecimal(value: string): boolean {
  return CANONICAL_DECIMAL.test(value) && value !== '-0';
}

const DECIMAL_INPUT = /^([+-])?(\d*)(?:\.(\d*))?$/;

/**
 * What a caller does to a number as entered before it is stored: `007.50` becomes `7.5`, `-0` becomes
 * `0`, `.5` becomes `0.5`. Returns undefined for anything that is not a decimal. Digits are never
 * rounded, so no value is changed on the way in - only spelled one way.
 */
export function canonicaliseDecimal(input: string): string | undefined {
  const match = DECIMAL_INPUT.exec(input);
  if (!match) return undefined;
  const [, sign, whole = '', fraction = ''] = match;
  if (whole === '' && fraction === '') return undefined;
  const integer = whole.replace(/^0+/, '') || '0';
  const fractional = fraction.replace(/0+$/, '');
  const magnitude = fractional ? `${integer}.${fractional}` : integer;
  return sign === '-' && magnitude !== '0' ? `-${magnitude}` : magnitude;
}

/** Negative, zero or positive, as `a` is below, equal to or above `b`. Both must be canonical. */
export function compareDecimal(a: string, b: string): number {
  const negativeA = a.startsWith('-');
  const negativeB = b.startsWith('-');
  if (negativeA !== negativeB) return negativeA ? -1 : 1;
  const magnitude = compareMagnitude(negativeA ? a.slice(1) : a, negativeB ? b.slice(1) : b);
  return negativeA ? 0 - magnitude : magnitude;
}

function compareMagnitude(a: string, b: string): number {
  const [integerA = '', fractionA = ''] = a.split('.');
  const [integerB = '', fractionB = ''] = b.split('.');
  if (integerA.length !== integerB.length) return integerA.length < integerB.length ? -1 : 1;
  if (integerA !== integerB) return integerA < integerB ? -1 : 1;
  const width = Math.max(fractionA.length, fractionB.length);
  const paddedA = fractionA.padEnd(width, '0');
  const paddedB = fractionB.padEnd(width, '0');
  return paddedA === paddedB ? 0 : paddedA < paddedB ? -1 : 1;
}

/** How many decimal places a canonical decimal carries. */
export function decimalScale(value: string): number {
  const point = value.indexOf('.');
  return point === -1 ? 0 : value.length - point - 1;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** `YYYY-MM-DD`, a real calendar day from year 1, and no offset (MET-028). */
export function isIsoDate(value: string): boolean {
  const match = DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** `HH:MM` or `HH:MM:SS`, and no offset (MET-028). */
export function isIsoTime(value: string): boolean {
  return TIME.test(value);
}

/** A time as `HH:MM:SS`, so that `09:00` and `09:00:00` compare equal and order as strings. */
export function timeKey(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}

const DATE_TIME =
  /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,9}))?)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

/**
 * The instant an ISO 8601 date and time names, in nanoseconds from 1970-01-01T00:00Z, or undefined
 * when it is not one. The offset, or `Z`, is required: a date and time without one names no instant
 * (MET-028).
 */
export function dateTimeInstant(value: string): bigint | undefined {
  const match = DATE_TIME.exec(value);
  if (!match) return undefined;
  const [, date = '', hour = '', minute = '', second = '0', fraction = '', offset = 'Z'] = match;
  if (!isIsoDate(date)) return undefined;
  const days = daysFromCivil(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)),
    Number(date.slice(8)),
  );
  const offsetMinutes =
    offset === 'Z'
      ? 0
      : (offset.startsWith('-') ? -1 : 1) *
        (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
  const minutes = BigInt(days) * 1440n + BigInt(Number(hour) * 60 + Number(minute) - offsetMinutes);
  return (
    (minutes * 60n + BigInt(Number(second))) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0'))
  );
}

/** Days from 1970-01-01 to a proleptic Gregorian date. Howard Hinnant's `days_from_civil`. */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const shiftedMonth = (month + 9) % 12;
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/domain test -- src/metadata/lexical`
Expected: PASS, 6 tests.

- [ ] **Step 5: Regenerate the trace and move the citation pin**

Run: `pnpm --filter @alloy-works/trace generate`, then in `packages/trace/src/trace.test.ts`:

```ts
expect(model.citations).toHaveLength(68);
```

- [ ] **Step 6: Run the gate**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format
```

Expected: every suite passes with no warnings.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/metadata/lexical.ts packages/domain/src/metadata/lexical.test.ts packages/trace/trace.json packages/trace/src/trace.test.ts
git commit -m "Add the lexical forms metadata values take, compared exactly"
```

---

## Task 3: Field definitions

**Files:**

- Create: `packages/domain/src/metadata/definition.ts`, `packages/domain/src/metadata/field.ts`
- Modify: `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`
- Test: `packages/domain/src/metadata/field.test.ts`

**Interfaces:**

- Consumes: `isCanonicalDecimal`, `isIsoDate`, `isIsoTime`, `dateTimeInstant` from `./lexical.js`
- Produces: `DEFINITION_SCHEMA_VERSION`, `definitionIdentity` (the zod shape
  `{ schemaVersion, id, name }`), `dataTypes`, `type DataType`, `fieldDefinitionSchema`,
  `type FieldDefinition` - a union discriminated by `dataType`, each with
  `multiplicity: 'one' | 'many'`, `maxValues?: number` and its own `validation` object

The `validation` members per data type are metadata.md's table, less `pattern` (Global Constraints).
Each validation object is strict, so a member another data type takes is refused rather than ignored.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/metadata/field.test.ts
import { describe, expect, it } from 'vitest';

import { DEFINITION_SCHEMA_VERSION } from './definition.js';
import { dataTypes, fieldDefinitionSchema } from './field.js';

/** A copy of `value` without `member`, for a test that a member is required. */
const without = (value: Record<string, unknown>, member: string) =>
  Object.fromEntries(Object.entries(value).filter(([key]) => key !== member));

const field = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  schemaVersion: DEFINITION_SCHEMA_VERSION,
  id: 'field-study',
  name: 'Study number',
  dataType: 'text',
  multiplicity: 'one',
  validation: {},
  ...overrides,
});

describe('a field definition', () => {
  it('MET-001 carries an identifier, a name, a data type and its validation', () => {
    expect(fieldDefinitionSchema.parse(field({ validation: { maxLength: 20 } }))).toEqual(
      field({ validation: { maxLength: 20 } }),
    );
    for (const member of ['id', 'name', 'dataType', 'validation']) {
      expect(() => fieldDefinitionSchema.parse(without(field(), member)), member).toThrow();
    }
  });

  it('MET-002 closes the data types at the seven the requirement names', () => {
    expect([...dataTypes].sort()).toEqual(
      ['boolean', 'date', 'dateTime', 'number', 'text', 'time', 'user'].sort(),
    );
    expect(() => fieldDefinitionSchema.parse(field({ dataType: 'vocabulary' }))).toThrow();
  });

  it('MET-002 makes a field declare whether it holds one value or several', () => {
    expect(fieldDefinitionSchema.parse(field({ multiplicity: 'many' })).multiplicity).toBe('many');
    expect(() => fieldDefinitionSchema.parse(without(field(), 'multiplicity'))).toThrow();
    expect(() => fieldDefinitionSchema.parse(field({ multiplicity: 'several' }))).toThrow();
  });

  it('MET-030 lets a field holding several values declare the most it may hold, and only that field', () => {
    expect(
      fieldDefinitionSchema.parse(field({ multiplicity: 'many', maxValues: 3 })).maxValues,
    ).toBe(3);
    expect(() => fieldDefinitionSchema.parse(field({ multiplicity: 'one', maxValues: 3 }))).toThrow(
      /maxValues/,
    );
    expect(() =>
      fieldDefinitionSchema.parse(field({ multiplicity: 'many', maxValues: 0 })),
    ).toThrow();
  });

  it('MET-004 declares validation per data type, and refuses a member another type takes', () => {
    expect(() =>
      fieldDefinitionSchema.parse(
        field({ dataType: 'number', validation: { min: '0', scale: 2 } }),
      ),
    ).not.toThrow();
    expect(() =>
      fieldDefinitionSchema.parse(field({ dataType: 'text', validation: { scale: 2 } })),
    ).toThrow();
    expect(() =>
      fieldDefinitionSchema.parse(field({ dataType: 'boolean', validation: { min: '0' } })),
    ).toThrow();
    expect(() =>
      fieldDefinitionSchema.parse(field({ dataType: 'user', validation: { maxLength: 4 } })),
    ).toThrow();
  });

  it('refuses a pattern on a text field, because no pattern ships until backtracking is bounded', () => {
    expect(() =>
      fieldDefinitionSchema.parse(field({ validation: { pattern: '^[A-Z]{3}-\\d{3}$' } })),
    ).toThrow();
  });

  it('MET-002 writes a number bound as a canonical decimal string, never a JSON number', () => {
    expect(() =>
      fieldDefinitionSchema.parse(field({ dataType: 'number', validation: { min: 0 } })),
    ).toThrow();
    expect(() =>
      fieldDefinitionSchema.parse(field({ dataType: 'number', validation: { max: '1.50' } })),
    ).toThrow();
  });

  it('MET-028 writes a date bound with no offset, and a date and time bound with one', () => {
    expect(() =>
      fieldDefinitionSchema.parse(field({ dataType: 'date', validation: { min: '2026-01-01Z' } })),
    ).toThrow();
    expect(() =>
      fieldDefinitionSchema.parse(
        field({ dataType: 'dateTime', validation: { min: '2026-01-01T00:00' } }),
      ),
    ).toThrow();
    expect(() =>
      fieldDefinitionSchema.parse(
        field({ dataType: 'dateTime', validation: { min: '2026-01-01T00:00+01:00' } }),
      ),
    ).not.toThrow();
  });

  it('MET-001 records the definition schema version it was written against', () => {
    expect(() => fieldDefinitionSchema.parse(field({ schemaVersion: 99 }))).toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain test -- src/metadata/field`
Expected: FAIL, the imports `./definition.js` and `./field.js` do not resolve.

- [ ] **Step 3: Write `definition.ts`**

```ts
// packages/domain/src/metadata/definition.ts
import { z } from 'zod';

/**
 * The definition schema version every field, metadata schema and component type payload records
 * (MET-002: adding a data type is a version of this, with a migration and a fixture). One number
 * across the three kinds, so a fixture directory is one version of all three; a version that changes
 * only one kind gives the others an identity step.
 */
export const DEFINITION_SCHEMA_VERSION = 1;

/** What every definition carries, whatever its kind. */
export const definitionIdentity = {
  schemaVersion: z.literal(DEFINITION_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
};
```

- [ ] **Step 4: Write `field.ts`**

```ts
// packages/domain/src/metadata/field.ts
import { z } from 'zod';

import { definitionIdentity } from './definition.js';
import { dateTimeInstant, isCanonicalDecimal, isIsoDate, isIsoTime } from './lexical.js';

/** Closed (MET-002). Adding one is a definition schema version with a migration, never configuration. */
export const dataTypes = ['text', 'number', 'date', 'time', 'dateTime', 'boolean', 'user'] as const;

export type DataType = (typeof dataTypes)[number];

const cardinality = {
  multiplicity: z.enum(['one', 'many']),
  maxValues: z.number().int().min(1).optional(),
};

const length = z.number().int().min(0).optional();
const decimal = z.string().refine(isCanonicalDecimal, 'not a canonical decimal string').optional();
const date = z.string().refine(isIsoDate, 'not a date, YYYY-MM-DD').optional();
const time = z.string().refine(isIsoTime, 'not a time, HH:MM or HH:MM:SS').optional();
const dateTime = z
  .string()
  .refine((value) => dateTimeInstant(value) !== undefined, 'not a date and time with an offset')
  .optional();

const field = <T extends DataType, V extends z.ZodRawShape>(dataType: T, validation: V) =>
  z.strictObject({
    ...definitionIdentity,
    dataType: z.literal(dataType),
    ...cardinality,
    validation: z.strictObject(validation),
  });

/**
 * A field (MET-001). `validation` is what a value IS (MET-004), declared per data type.
 *
 * `pattern` is deliberately absent from `text`: metadata.md's open question on keeping a pattern from
 * backtracking exponentially is unanswered, and the design says `pattern` does not ship until it is.
 * The strict object refuses it, so a definition written today cannot carry one that nothing enforces.
 */
export const fieldDefinitionSchema = z
  .discriminatedUnion('dataType', [
    field('text', { minLength: length, maxLength: length }),
    field('number', {
      min: decimal,
      max: decimal,
      integer: z.boolean().optional(),
      scale: z.number().int().min(0).optional(),
    }),
    field('date', { min: date, max: date }),
    field('time', { min: time, max: time }),
    field('dateTime', { min: dateTime, max: dateTime }),
    field('boolean', {}),
    field('user', {}),
  ])
  .superRefine((definition, context) => {
    if (definition.maxValues !== undefined && definition.multiplicity !== 'many') {
      context.addIssue({
        code: 'custom',
        path: ['maxValues'],
        message: 'maxValues is declared only on a field holding several values',
      });
    }
  });

export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>;
```

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/domain test -- src/metadata/field`
Expected: PASS, 9 tests.

- [ ] **Step 6: Regenerate the trace and move the citation pin**

Run: `pnpm --filter @alloy-works/trace generate`, then in `packages/trace/src/trace.test.ts`:

```ts
expect(model.citations).toHaveLength(73);
```

- [ ] **Step 7: Run the gate**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format
```

Expected: every suite passes with no warnings.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/metadata/definition.ts packages/domain/src/metadata/field.ts packages/domain/src/metadata/field.test.ts packages/trace/trace.json packages/trace/src/trace.test.ts
git commit -m "Add field definitions: seven closed data types, no pattern yet"
```

---

## Task 4: `checkValue`, and the failure every rule returns

**Files:**

- Create: `packages/domain/src/metadata/failure.ts`, `packages/domain/src/metadata/values.ts`,
  `packages/domain/src/metadata/check-value.ts`
- Modify: `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`
- Test: `packages/domain/src/metadata/check-value.test.ts`

**Interfaces:**

- Consumes: `type FieldDefinition`; the lexical functions; `canonicalJson` from `../stored/canonical.js`
- Produces:
  - `type MetadataRule`; `type MetadataFailure`, whose members are `code` (the template literal type
    `metadata.<rule>`), `field: string`, `rule: MetadataRule`, `schemas: readonly string[]` and
    `detail: string`; `failure(field, rule, detail, schemas = []): MetadataFailure`
  - `type MetadataValues = Readonly<Record<string, unknown>>`, `type UserValue = { user: string }`,
    `hasMember(values, field): boolean`, `isClear(value): boolean`, `isUserValue(value): value is UserValue`,
    `sameValue(a, b): boolean`
  - `checkValue(field: FieldDefinition, value: unknown): MetadataFailure[]`

MET-004 is the signature: the field and the value, nothing else. The values type is `unknown` per
member on purpose, because a value that is not the JSON its data type takes is a failure to report,
not a type error to assume away. `values.ts` carries four small predicates later tasks use; they are
written here because `checkValue` needs two of them and they belong together.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/metadata/check-value.test.ts
import { describe, expect, it } from 'vitest';

import { checkValue } from './check-value.js';
import { DEFINITION_SCHEMA_VERSION } from './definition.js';
import { fieldDefinitionSchema, type FieldDefinition } from './field.js';

const fieldOf = (
  dataType: string,
  validation: Record<string, unknown> = {},
  cardinality: Record<string, unknown> = { multiplicity: 'one' },
): FieldDefinition =>
  fieldDefinitionSchema.parse({
    schemaVersion: DEFINITION_SCHEMA_VERSION,
    id: `field-${dataType}`,
    name: `A ${dataType} field`,
    dataType,
    validation,
    ...cardinality,
  });

const many = (dataType: string, validation: Record<string, unknown> = {}, maxValues?: number) =>
  fieldOf(dataType, validation, {
    multiplicity: 'many',
    ...(maxValues === undefined ? {} : { maxValues }),
  });

/** The codes alone, so each test says exactly which rules fired and no others. */
const codes = (field: FieldDefinition, value: unknown) =>
  checkValue(field, value).map((each) => each.code);

describe('checkValue', () => {
  it('MET-004 takes the field and the value and nothing else', () => {
    expect(checkValue.length).toBe(2);
    const field = fieldOf('text', { maxLength: 5 });
    // The same value for the same field, asked twice as two artifacts would ask it.
    expect(checkValue(field, 'Grace Hopper')).toEqual(checkValue(field, 'Grace Hopper'));
  });

  it('MET-022 names the field, the rule and a stable code, and no schema for a rule the field owns', () => {
    expect(checkValue(fieldOf('text', { maxLength: 3 }), 'Alice')).toEqual([
      {
        code: 'metadata.maxLength',
        field: 'field-text',
        rule: 'maxLength',
        schemas: [],
        detail: 'Is longer than 3 characters',
      },
    ]);
  });

  it('MET-002 fails type for a value that is not the JSON its data type takes', () => {
    const wrong: [string, unknown, unknown][] = [
      ['text', 42, 'Ada'],
      ['number', 0.1, '0.1'],
      ['number', '1.50', '1.5'],
      ['date', '15/09/2026', '2026-09-15'],
      ['time', '9am', '09:00'],
      ['dateTime', '2026-09-15T09:00', '2026-09-15T09:00Z'],
      ['boolean', 'true', true],
      ['user', 'user-ada', { user: 'user-ada' }],
      ['user', { user: 'user-ada', name: 'Ada' }, { user: 'user-ada' }],
    ];
    for (const [dataType, bad, good] of wrong) {
      expect(codes(fieldOf(dataType), bad), `${dataType} ${JSON.stringify(bad)}`).toEqual([
        'metadata.type',
      ]);
      expect(codes(fieldOf(dataType), good), `${dataType} ${JSON.stringify(good)}`).toEqual([]);
    }
  });

  it('MET-028 fails type for a date or a time with an offset, and a date and time without one', () => {
    expect(codes(fieldOf('date'), '2026-09-15+01:00')).toEqual(['metadata.type']);
    expect(codes(fieldOf('time'), '09:00Z')).toEqual(['metadata.type']);
    expect(codes(fieldOf('dateTime'), '2026-09-15T09:00')).toEqual(['metadata.type']);
    expect(codes(fieldOf('dateTime'), '2026-09-15T09:00-05:00')).toEqual([]);
  });

  it('MET-030 treats null on a one field and an empty list on a many field as a clear, not a failure', () => {
    expect(codes(fieldOf('text'), null)).toEqual([]);
    expect(codes(many('text'), [])).toEqual([]);
  });

  it('MET-030 fails multiplicity for a list on a one field, and a single value on a many field', () => {
    expect(codes(fieldOf('text'), ['Ada'])).toEqual(['metadata.multiplicity']);
    expect(codes(many('text'), 'Ada')).toEqual(['metadata.multiplicity']);
    expect(codes(many('text'), null)).toEqual(['metadata.multiplicity']);
  });

  it('MET-030 fails multiplicity for a value held twice, after normalisation', () => {
    expect(codes(many('text'), ['Ada', 'Grace'])).toEqual([]);
    expect(codes(many('text'), ['Ada', 'Grace', 'Ada'])).toEqual(['metadata.multiplicity']);
    expect(codes(many('text'), ['caf\u00e9', 'cafe\u0301'])).toEqual(['metadata.multiplicity']);
    expect(codes(many('time'), ['09:00', '09:00:00'])).toEqual(['metadata.multiplicity']);
    expect(codes(many('dateTime'), ['2026-09-15T10:00+01:00', '2026-09-15T09:00Z'])).toEqual([
      'metadata.multiplicity',
    ]);
    expect(codes(many('user'), [{ user: 'user-ada' }, { user: 'user-ada' }])).toEqual([
      'metadata.multiplicity',
    ]);
  });

  it('MET-030 keeps a many value in the order given, and reports a repeat by position', () => {
    const [repeat] = checkValue(many('text'), ['Grace', 'Ada', 'Grace']);
    expect(repeat?.detail).toBe('Value 3 repeats value 1');
  });

  it('MET-030 fails maxValues for more values than the field declares', () => {
    expect(codes(many('text', {}, 2), ['Ada', 'Grace'])).toEqual([]);
    expect(codes(many('text', {}, 2), ['Ada', 'Grace', 'Alice'])).toEqual(['metadata.maxValues']);
  });

  it('MET-004 fails minLength and maxLength, counting characters of the NFC form', () => {
    const field = fieldOf('text', { minLength: 2, maxLength: 4 });
    expect(codes(field, 'A')).toEqual(['metadata.minLength']);
    expect(codes(field, 'Grace')).toEqual(['metadata.maxLength']);
    expect(codes(field, 'Ada')).toEqual([]);
    expect(codes(field, 'cafe\u0301')).toEqual([]);
  });

  it('MET-004 fails min and max on a number, compared exactly', () => {
    const field = fieldOf('number', { min: '0.1', max: '9007199254740993' });
    expect(codes(field, '0.09')).toEqual(['metadata.min']);
    expect(codes(field, '9007199254740994')).toEqual(['metadata.max']);
    expect(codes(field, '0.1')).toEqual([]);
    expect(codes(field, '9007199254740993')).toEqual([]);
  });

  it('MET-004 fails integer and scale on a number', () => {
    expect(codes(fieldOf('number', { integer: true }), '2.5')).toEqual(['metadata.integer']);
    expect(codes(fieldOf('number', { integer: true }), '-3')).toEqual([]);
    expect(codes(fieldOf('number', { scale: 2 }), '1.125')).toEqual(['metadata.scale']);
    expect(codes(fieldOf('number', { scale: 2 }), '1.12')).toEqual([]);
  });

  it('MET-004 fails min and max on a date and a time', () => {
    const date = fieldOf('date', { min: '2026-01-01', max: '2026-12-31' });
    expect(codes(date, '2025-12-31')).toEqual(['metadata.min']);
    expect(codes(date, '2027-01-01')).toEqual(['metadata.max']);
    expect(codes(date, '2026-06-30')).toEqual([]);
    const time = fieldOf('time', { min: '09:00', max: '17:30' });
    expect(codes(time, '08:59:59')).toEqual(['metadata.min']);
    expect(codes(time, '17:30:01')).toEqual(['metadata.max']);
    expect(codes(time, '09:00:00')).toEqual([]);
  });

  it('MET-028 compares date and time bounds as instants, whatever the offset', () => {
    const field = fieldOf('dateTime', { min: '2026-09-15T09:00Z' });
    expect(codes(field, '2026-09-15T09:30+01:00')).toEqual(['metadata.min']);
    expect(codes(field, '2026-09-15T05:00-04:00')).toEqual([]);
  });

  it('MET-030 checks every value of a many field, naming each by position', () => {
    const failures = checkValue(many('text', { maxLength: 3 }), ['Ada', 'Grace', 7]);
    expect(failures.map((each) => [each.code, each.detail])).toEqual([
      ['metadata.maxLength', 'Value 2: Is longer than 3 characters'],
      ['metadata.type', 'Value 3: Is not text'],
    ]);
  });

  it('MET-002 keeps a decimal exactly as written, where a float would change it', () => {
    const field = fieldOf('number');
    for (const value of ['9007199254740993', '0.1000000000000000055', '1234567890.123456789012']) {
      // The premise: each of these is a value a binary float cannot hold.
      expect(String(Number(value)), value).not.toBe(value);
      expect(codes(field, value), value).toEqual([]);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain test -- src/metadata/check-value`
Expected: FAIL, the import `./check-value.js` does not resolve.

- [ ] **Step 3: Write `failure.ts`**

```ts
// packages/domain/src/metadata/failure.ts
/**
 * Every rule a metadata failure can name. The first six are validation's (metadata.md, Validation);
 * `user` is `checkUserValues`'; `default`, `requires` and `defaultConflict` are failures of a
 * definition rather than of a value, found by `checkSchema` and `checkAssignment`.
 */
export type MetadataRule =
  | 'required'
  | 'fixed'
  | 'type'
  | 'multiplicity'
  | 'maxValues'
  | 'minLength'
  | 'maxLength'
  | 'min'
  | 'max'
  | 'integer'
  | 'scale'
  | 'user'
  | 'default'
  | 'requires'
  | 'defaultConflict';

/**
 * MET-022. `code` is stable, so the editor, the service and the publisher report one failure the same
 * way. `schemas` lists every schema that imposed the rule, and is empty for a rule that is the field's
 * alone (MET-004). The artifact is the caller's to add: nothing here knows which artifact it is.
 */
export type MetadataFailure = {
  readonly code: `metadata.${MetadataRule}`;
  readonly field: string;
  readonly rule: MetadataRule;
  readonly schemas: readonly string[];
  readonly detail: string;
};

export function failure(
  field: string,
  rule: MetadataRule,
  detail: string,
  schemas: readonly string[] = [],
): MetadataFailure {
  return { code: `metadata.${rule}`, field, rule, schemas: [...schemas], detail };
}
```

- [ ] **Step 4: Write `values.ts`**

```ts
// packages/domain/src/metadata/values.ts
import { canonicalJson } from '../stored/canonical.js';

/**
 * A component's metadata values, keyed by field identifier. Typed `unknown` per member on purpose:
 * values arrive from storage, the API and imports, and whether one is the JSON its data type takes is
 * a validation failure to report (`metadata.type`), not a type error to assume away.
 *
 * **No member and a clear are different.** No member: never given a value. `null` on a field holding
 * one value, or `[]` on a field holding several: cleared, and kept as written.
 */
export type MetadataValues = Readonly<Record<string, unknown>>;

/** A `user` value: the principal's identifier, in an object so the form can grow without a rename. */
export type UserValue = { readonly user: string };

export function hasMember(values: MetadataValues, field: string): boolean {
  return Object.hasOwn(values, field) && values[field] !== undefined;
}

export function isClear(value: unknown): boolean {
  return value === null || (Array.isArray(value) && value.length === 0);
}

export function isUserValue(value: unknown): value is UserValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as { user?: unknown }).user === 'string' &&
    (value as { user: string }).user.length > 0
  );
}

/** Two values are one value when their canonical serialisations are one string. */
export function sameValue(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}
```

- [ ] **Step 5: Write `check-value.ts`**

```ts
// packages/domain/src/metadata/check-value.ts
import { failure, type MetadataFailure } from './failure.js';
import type { FieldDefinition } from './field.js';
import {
  compareDecimal,
  dateTimeInstant,
  decimalScale,
  isCanonicalDecimal,
  isIsoDate,
  isIsoTime,
  timeKey,
} from './lexical.js';
import { isUserValue } from './values.js';

/**
 * MET-004: whether a value is valid for a field, from the field and the value and nothing else. No
 * artifact, no schema, no directory, no clock - so there is no context that could make one value
 * valid in one place and invalid in another.
 *
 * Returns every failure, never the first. A clear - `null` on a field holding one value, `[]` on a
 * field holding several - is not a failure here; whether a field may be clear is `required`'s, which
 * a schema imposes and `validate` checks.
 */
export function checkValue(field: FieldDefinition, value: unknown): MetadataFailure[] {
  if (field.multiplicity === 'one') {
    if (value === null) return [];
    if (Array.isArray(value)) {
      return [failure(field.id, 'multiplicity', 'Holds a list, and this field holds one value')];
    }
    return checkElement(field, value);
  }

  if (!Array.isArray(value)) {
    return [failure(field.id, 'multiplicity', 'Holds one value, and this field holds a list')];
  }
  const failures: MetadataFailure[] = [];
  if (field.maxValues !== undefined && value.length > field.maxValues) {
    failures.push(
      failure(
        field.id,
        'maxValues',
        `Holds ${value.length} values, and this field holds at most ${field.maxValues}`,
      ),
    );
  }
  const seen = new Map<string, number>();
  value.forEach((element: unknown, index) => {
    const own = checkElement(field, element);
    failures.push(
      ...own.map((each) => ({ ...each, detail: `Value ${index + 1}: ${each.detail}` })),
    );
    if (own.some((each) => each.rule === 'type')) return;
    // MET-030: no value twice, after normalisation - so `café` spelled two ways, `09:00` and
    // `09:00:00`, and one instant at two offsets are each one value.
    const key = elementKey(field, element);
    const first = seen.get(key);
    if (first === undefined) seen.set(key, index);
    else {
      failures.push(
        failure(field.id, 'multiplicity', `Value ${index + 1} repeats value ${first + 1}`),
      );
    }
  });
  return failures;
}

function typeFailure(field: FieldDefinition, expected: string): MetadataFailure {
  return failure(field.id, 'type', `Is not ${expected}`);
}

function checkElement(field: FieldDefinition, value: unknown): MetadataFailure[] {
  switch (field.dataType) {
    case 'text': {
      if (typeof value !== 'string') return [typeFailure(field, 'text')];
      // Counted in code points of the NFC form, so a length does not depend on how the text was typed.
      const length = [...value.normalize('NFC')].length;
      const failures: MetadataFailure[] = [];
      const { minLength, maxLength } = field.validation;
      if (minLength !== undefined && length < minLength) {
        failures.push(failure(field.id, 'minLength', `Is shorter than ${minLength} characters`));
      }
      if (maxLength !== undefined && length > maxLength) {
        failures.push(failure(field.id, 'maxLength', `Is longer than ${maxLength} characters`));
      }
      return failures;
    }
    case 'number': {
      if (typeof value !== 'string' || !isCanonicalDecimal(value)) {
        return [
          typeFailure(field, 'a decimal written as a string, with no leading or trailing zeros'),
        ];
      }
      const failures = checkRange(field.id, value, field.validation, compareDecimal);
      if (field.validation.integer === true && value.includes('.')) {
        failures.push(failure(field.id, 'integer', 'Is not a whole number'));
      }
      const { scale } = field.validation;
      if (scale !== undefined && decimalScale(value) > scale) {
        failures.push(failure(field.id, 'scale', `Has more than ${scale} decimal places`));
      }
      return failures;
    }
    case 'date':
      if (typeof value !== 'string' || !isIsoDate(value)) {
        return [typeFailure(field, 'a date written YYYY-MM-DD, with no offset')];
      }
      return checkRange(field.id, value, field.validation, compareStrings);
    case 'time':
      if (typeof value !== 'string' || !isIsoTime(value)) {
        return [typeFailure(field, 'a time written HH:MM or HH:MM:SS, with no offset')];
      }
      return checkRange(field.id, value, field.validation, (a, b) =>
        compareStrings(timeKey(a), timeKey(b)),
      );
    case 'dateTime':
      if (typeof value !== 'string' || dateTimeInstant(value) === undefined) {
        return [typeFailure(field, 'a date and time with its offset from UTC')];
      }
      return checkRange(field.id, value, field.validation, compareInstants);
    case 'boolean':
      return typeof value === 'boolean' ? [] : [typeFailure(field, 'true or false')];
    case 'user':
      return isUserValue(value) ? [] : [typeFailure(field, 'a user')];
  }
}

function elementKey(field: FieldDefinition, value: unknown): string {
  switch (field.dataType) {
    case 'text':
      return (value as string).normalize('NFC');
    case 'time':
      return timeKey(value as string);
    case 'dateTime':
      return String(dateTimeInstant(value as string));
    case 'user':
      return (value as { user: string }).user;
    default:
      return String(value);
  }
}

const compareStrings = (a: string, b: string) => (a === b ? 0 : a < b ? -1 : 1);

const compareInstants = (a: string, b: string) => {
  const difference = (dateTimeInstant(a) ?? 0n) - (dateTimeInstant(b) ?? 0n);
  return difference === 0n ? 0 : difference < 0n ? -1 : 1;
};

function checkRange(
  field: string,
  value: string,
  bounds: { readonly min?: string | undefined; readonly max?: string | undefined },
  compare: (a: string, b: string) => number,
): MetadataFailure[] {
  const failures: MetadataFailure[] = [];
  if (bounds.min !== undefined && compare(value, bounds.min) < 0) {
    failures.push(failure(field, 'min', `Is below the minimum, ${bounds.min}`));
  }
  if (bounds.max !== undefined && compare(value, bounds.max) > 0) {
    failures.push(failure(field, 'max', `Is above the maximum, ${bounds.max}`));
  }
  return failures;
}
```

- [ ] **Step 6: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/domain test -- src/metadata/check-value`
Expected: PASS, 16 tests.

- [ ] **Step 7: Prove each rule's test fails without the rule**

For each of `minLength`, `maxLength`, `min`, `max`, `integer`, `scale`, `maxValues` and the repeat
check: comment out the `failures.push(...)` for that rule, run the file, and watch at least one test
fail, naming that rule's code. Restore it before moving on. This is the design's "a rule whose test
passes with the rule removed is not tested", done by hand once rather than assumed.

- [ ] **Step 8: Regenerate the trace and move the citation pin**

Run: `pnpm --filter @alloy-works/trace generate`, then in `packages/trace/src/trace.test.ts`:

```ts
expect(model.citations).toHaveLength(78);
```

- [ ] **Step 9: Run the gate**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format
```

Expected: every suite passes with no warnings.

- [ ] **Step 10: Commit**

```bash
git add packages/domain/src/metadata/failure.ts packages/domain/src/metadata/values.ts packages/domain/src/metadata/check-value.ts packages/domain/src/metadata/check-value.test.ts packages/trace/trace.json packages/trace/src/trace.test.ts
git commit -m "Check a value against its field alone, returning every failure named"
```

---

## Task 5: Metadata schemas and component types

**Files:**

- Create: `packages/domain/src/metadata/schema.ts`, `packages/domain/src/metadata/component-type.ts`
- Modify: `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`
- Test: `packages/domain/src/metadata/schema.test.ts`

**Interfaces:**

- Consumes: `definitionIdentity`, `type FieldDefinition`, `checkValue`, `failure`, `isClear`
- Produces: `schemaEntrySchema`, `type SchemaEntry = { field; required; default?: unknown; fixed }`,
  `metadataSchemaDefinitionSchema`, `type MetadataSchemaDefinition`,
  `checkSchema(schema, fields: readonly FieldDefinition[]): MetadataFailure[]`, `assignmentSchema`,
  `type Assignment = { schema: string; requires: string[] }`, `componentTypeDefinitionSchema`,
  `type ComponentTypeDefinition`

MET-009 by construction: an assignment is a strict object with `schema` and `requires` and nothing
else, so there is no member through which it could loosen a field, change a default or fix a value.
Decision 5 adds the three rules the design implies.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/metadata/schema.test.ts
import { describe, expect, it } from 'vitest';

import { componentTypeDefinitionSchema } from './component-type.js';
import { DEFINITION_SCHEMA_VERSION } from './definition.js';
import { fieldDefinitionSchema } from './field.js';
import { checkSchema, metadataSchemaDefinitionSchema } from './schema.js';

/** A copy of `value` without `member`, for a test that a member is required. */
const without = (value: Record<string, unknown>, member: string) =>
  Object.fromEntries(Object.entries(value).filter(([key]) => key !== member));

const identity = (id: string, name: string) => ({
  schemaVersion: DEFINITION_SCHEMA_VERSION,
  id,
  name,
});

const phase = fieldDefinitionSchema.parse({
  ...identity('field-phase', 'Trial phase'),
  dataType: 'number',
  multiplicity: 'one',
  validation: { integer: true, min: '1', max: '4' },
});

const reviewers = fieldDefinitionSchema.parse({
  ...identity('field-reviewers', 'Reviewers'),
  dataType: 'user',
  multiplicity: 'many',
  maxValues: 2,
  validation: {},
});

const schemaWith = (entries: unknown[]) => ({ ...identity('schema-reg', 'Regulatory'), entries });

describe('a metadata schema definition', () => {
  it('MET-005 carries an identifier, a name and the fields it groups', () => {
    const schema = metadataSchemaDefinitionSchema.parse(
      schemaWith([{ field: 'field-phase', required: true, fixed: false }]),
    );
    expect(schema).toMatchObject({ id: 'schema-reg', name: 'Regulatory' });
    expect(() => metadataSchemaDefinitionSchema.parse({ ...schemaWith([]), name: '' })).toThrow();
  });

  it('MET-006 declares for each field whether it is required, its default, and whether it is fixed', () => {
    const entry = { field: 'field-phase', required: false, default: '2', fixed: true };
    expect(metadataSchemaDefinitionSchema.parse(schemaWith([entry])).entries).toEqual([entry]);
    for (const member of ['required', 'fixed']) {
      expect(
        () => metadataSchemaDefinitionSchema.parse(schemaWith([without(entry, member)])),
        member,
      ).toThrow();
    }
  });

  it('MET-006 refuses a fixed entry with no default to fix it at', () => {
    expect(() =>
      metadataSchemaDefinitionSchema.parse(
        schemaWith([{ field: 'field-phase', required: false, fixed: true }]),
      ),
    ).toThrow(/no default/);
  });

  it('MET-006 refuses a default that is a clear rather than a value', () => {
    for (const clear of [null, []]) {
      expect(() =>
        metadataSchemaDefinitionSchema.parse(
          schemaWith([{ field: 'field-phase', required: false, default: clear, fixed: false }]),
        ),
      ).toThrow(/clear/);
    }
  });

  it('refuses a schema grouping one field twice', () => {
    const entry = { field: 'field-phase', required: false, fixed: false };
    expect(() => metadataSchemaDefinitionSchema.parse(schemaWith([entry, entry]))).toThrow(
      /more than once/,
    );
  });

  it('MET-022 fails a default that does not pass its own field, naming the schema', () => {
    const schema = metadataSchemaDefinitionSchema.parse(
      schemaWith([
        { field: 'field-phase', required: false, default: '5', fixed: false },
        {
          field: 'field-reviewers',
          required: false,
          default: [{ user: 'user-ada' }],
          fixed: false,
        },
      ]),
    );
    expect(checkSchema(schema, [phase, reviewers])).toEqual([
      {
        code: 'metadata.default',
        field: 'field-phase',
        rule: 'default',
        schemas: ['schema-reg'],
        detail: 'The default fails max: Is above the maximum, 4',
      },
    ]);
  });

  it('MET-030 fails a default on a many field that is not a list', () => {
    const schema = metadataSchemaDefinitionSchema.parse(
      schemaWith([
        { field: 'field-reviewers', required: false, default: { user: 'user-ada' }, fixed: false },
      ]),
    );
    expect(checkSchema(schema, [phase, reviewers]).map((each) => each.detail)).toEqual([
      'The default fails multiplicity: Holds one value, and this field holds a list',
    ]);
  });
});

describe('a component type definition', () => {
  const type = (assignments: unknown[]) => ({
    ...identity('type-protocol', 'Protocol section'),
    assignments,
  });

  it('MET-010 carries an identifier, a name and zero or more assignments', () => {
    expect(componentTypeDefinitionSchema.parse(type([])).assignments).toEqual([]);
    expect(
      componentTypeDefinitionSchema.parse(
        type([{ schema: 'schema-reg', requires: ['field-phase'] }]),
      ).assignments,
    ).toHaveLength(1);
  });

  it('MET-010 carries nothing about the content a component holds', () => {
    expect(() =>
      componentTypeDefinitionSchema.parse({ ...type([]), blocks: ['paragraph'] }),
    ).toThrow();
    expect(() => componentTypeDefinitionSchema.parse({ ...type([]), content: [] })).toThrow();
  });

  it('MET-009 gives an assignment no member that could loosen, default or fix a field', () => {
    for (const member of [
      { optional: ['field-phase'] },
      { defaults: { 'field-phase': '2' } },
      { fixed: ['field-phase'] },
      { validation: {} },
    ]) {
      expect(
        () =>
          componentTypeDefinitionSchema.parse(
            type([{ schema: 'schema-reg', requires: [], ...member }]),
          ),
        JSON.stringify(member),
      ).toThrow();
    }
  });

  it('MET-010 refuses a schema assigned twice, and a field required twice by one assignment', () => {
    expect(() =>
      componentTypeDefinitionSchema.parse(
        type([
          { schema: 'schema-reg', requires: [] },
          { schema: 'schema-reg', requires: [] },
        ]),
      ),
    ).toThrow(/assigned more than once/);
    expect(() =>
      componentTypeDefinitionSchema.parse(
        type([{ schema: 'schema-reg', requires: ['field-phase', 'field-phase'] }]),
      ),
    ).toThrow(/more than once/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain test -- src/metadata/schema`
Expected: FAIL, the imports `./schema.js` and `./component-type.js` do not resolve.

- [ ] **Step 3: Write `schema.ts`**

```ts
// packages/domain/src/metadata/schema.ts
import { z } from 'zod';

import { checkValue } from './check-value.js';
import { definitionIdentity } from './definition.js';
import { failure, type MetadataFailure } from './failure.js';
import type { FieldDefinition } from './field.js';
import { isClear } from './values.js';

/** MET-006: for each field a schema groups, whether it is required, its default, and whether it is fixed. */
export const schemaEntrySchema = z.strictObject({
  field: z.string().min(1),
  required: z.boolean(),
  default: z.unknown().optional(),
  fixed: z.boolean(),
});

export type SchemaEntry = z.infer<typeof schemaEntrySchema>;

/**
 * MET-005: a named, versioned, tenant-wide definition grouping fields. The version is the artifact
 * row's, by the one mechanism (ADR-0024); the payload records only its definition schema version.
 *
 * Three rules the entries' shape cannot state alone. A field is grouped once. A fixed entry has a
 * default, since a fixed value is taken from it. And a default is a value rather than a clear: a
 * default of `null` or `[]` would satisfy "a fixed entry has a default" while fixing nothing, and
 * carrying forward would write a clear nobody made into a field with no member.
 */
export const metadataSchemaDefinitionSchema = z
  .strictObject({ ...definitionIdentity, entries: z.array(schemaEntrySchema) })
  .superRefine((schema, context) => {
    const seen = new Set<string>();
    schema.entries.forEach((entry, index) => {
      if (seen.has(entry.field)) {
        context.addIssue({
          code: 'custom',
          path: ['entries', index, 'field'],
          message: `Field ${entry.field} is grouped more than once`,
        });
      }
      seen.add(entry.field);
      if (entry.fixed && entry.default === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['entries', index, 'default'],
          message: `Field ${entry.field} is fixed and has no default to fix it at`,
        });
      }
      if (entry.default !== undefined && isClear(entry.default)) {
        context.addIssue({
          code: 'custom',
          path: ['entries', index, 'default'],
          message: `Field ${entry.field} has a clear as its default, and a default must be a value`,
        });
      }
    });
  });

export type MetadataSchemaDefinition = z.infer<typeof metadataSchemaDefinitionSchema>;

/**
 * A default must itself pass `checkValue` for its field (metadata.md, Definitions) - which needs the
 * field, so it is a check over definitions rather than part of the schema's shape. Each failure names
 * the schema, since the default is the schema's.
 */
export function checkSchema(
  schema: MetadataSchemaDefinition,
  fields: readonly FieldDefinition[],
): MetadataFailure[] {
  const byId = new Map(fields.map((field) => [field.id, field]));
  const failures: MetadataFailure[] = [];
  for (const entry of schema.entries) {
    const field = byId.get(entry.field);
    if (!field) {
      throw new Error(`Schema ${schema.id} groups field ${entry.field}, which was not supplied`);
    }
    if (entry.default === undefined) continue;
    for (const each of checkValue(field, entry.default)) {
      failures.push(
        failure(field.id, 'default', `The default fails ${each.rule}: ${each.detail}`, [schema.id]),
      );
    }
  }
  return failures;
}
```

- [ ] **Step 4: Write `component-type.ts`**

```ts
// packages/domain/src/metadata/component-type.ts
import { z } from 'zod';

import { definitionIdentity } from './definition.js';

/**
 * MET-009. An assignment names a schema and the fields it makes required, and has no other member -
 * so it cannot loosen a field, change a default or fix a value, because there is nowhere to say so.
 * That `requires` names only fields the schema groups needs the schema, so `checkAssignment` checks
 * it; resolution ignores a stray a later schema version leaves behind.
 */
export const assignmentSchema = z.strictObject({
  schema: z.string().min(1),
  requires: z.array(z.string().min(1)),
});

export type Assignment = z.infer<typeof assignmentSchema>;

/**
 * MET-010: a named, versioned, tenant-wide definition assigning zero or more schemas, and nothing
 * about content. A schema is assigned once, and a field is required by an assignment once.
 */
export const componentTypeDefinitionSchema = z
  .strictObject({ ...definitionIdentity, assignments: z.array(assignmentSchema) })
  .superRefine((type, context) => {
    const assigned = new Set<string>();
    type.assignments.forEach((assignment, index) => {
      if (assigned.has(assignment.schema)) {
        context.addIssue({
          code: 'custom',
          path: ['assignments', index, 'schema'],
          message: `Schema ${assignment.schema} is assigned more than once`,
        });
      }
      assigned.add(assignment.schema);
      if (new Set(assignment.requires).size !== assignment.requires.length) {
        context.addIssue({
          code: 'custom',
          path: ['assignments', index, 'requires'],
          message: `The assignment of ${assignment.schema} requires a field more than once`,
        });
      }
    });
  });

export type ComponentTypeDefinition = z.infer<typeof componentTypeDefinitionSchema>;
```

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/domain test -- src/metadata/schema`
Expected: PASS, 11 tests.

- [ ] **Step 6: Regenerate the trace and move the citation pin**

Run: `pnpm --filter @alloy-works/trace generate`, then in `packages/trace/src/trace.test.ts`:

```ts
expect(model.citations).toHaveLength(84);
```

- [ ] **Step 7: Run the gate**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format
```

Expected: every suite passes with no warnings.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/metadata/schema.ts packages/domain/src/metadata/component-type.ts packages/domain/src/metadata/schema.test.ts packages/trace/trace.json packages/trace/src/trace.test.ts
git commit -m "Add metadata schema and component type definitions"
```

---

## Task 6: Definition fixtures and migration on read

**Files:**

- Create: `packages/domain/src/metadata/migrate.ts`
- Create: `packages/domain/src/metadata/fixtures/v1/fields.json`,
  `packages/domain/src/metadata/fixtures/v1/metadata-schemas.json`,
  `packages/domain/src/metadata/fixtures/v1/component-types.json`
- Modify: `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`
- Test: `packages/domain/src/metadata/migrate.test.ts`

**Interfaces:**

- Consumes: `migrateStored`, `type MigrationChain`; the three definition schemas; `checkSchema`
- Produces: `definitionKinds`, `type DefinitionKind = 'field' | 'metadataSchema' | 'componentType'`,
  `type DefinitionOf`, `migrateDefinition(kind, value): Record<string, unknown>`,
  `type DefinitionReadOutcome<K>`,
  `readDefinition<K>(kind: K, value: unknown, context: { artifact: string; version: string }): DefinitionReadOutcome<K>`

"A field defined in 2026 must still read in 2040" (metadata.md, Definitions). With one definition
schema version every chain is empty; the chain, the fixture directory and the test that reads every
fixture at the current version exist anyway, for the reason content's do.

**A fixture directory is never deleted.** A later definition schema version adds `fixtures/v2/` beside
it, and the first test below reads both.

- [ ] **Step 1: Write the fixtures**

`fields.json` carries every data type, both multiplicities, `maxValues` and every validation member, so
a later migration cannot drop one unnoticed; a test checks that it does.

```json
[
  {
    "schemaVersion": 1,
    "id": "field-study-number",
    "name": "Study number",
    "dataType": "text",
    "multiplicity": "one",
    "validation": { "minLength": 3, "maxLength": 20 }
  },
  {
    "schemaVersion": 1,
    "id": "field-keywords",
    "name": "Keywords",
    "dataType": "text",
    "multiplicity": "many",
    "maxValues": 10,
    "validation": {}
  },
  {
    "schemaVersion": 1,
    "id": "field-dose",
    "name": "Dose in mg",
    "dataType": "number",
    "multiplicity": "one",
    "validation": { "min": "0", "max": "1000", "scale": 3 }
  },
  {
    "schemaVersion": 1,
    "id": "field-phase",
    "name": "Trial phase",
    "dataType": "number",
    "multiplicity": "one",
    "validation": { "integer": true, "min": "1", "max": "4" }
  },
  {
    "schemaVersion": 1,
    "id": "field-effective-date",
    "name": "Effective date",
    "dataType": "date",
    "multiplicity": "one",
    "validation": { "min": "2000-01-01", "max": "2099-12-31" }
  },
  {
    "schemaVersion": 1,
    "id": "field-review-time",
    "name": "Review time",
    "dataType": "time",
    "multiplicity": "one",
    "validation": { "min": "09:00", "max": "17:30:00" }
  },
  {
    "schemaVersion": 1,
    "id": "field-approved-at",
    "name": "Approved at",
    "dataType": "dateTime",
    "multiplicity": "one",
    "validation": { "min": "2026-01-01T00:00Z", "max": "2099-12-31T23:59:59.999+14:00" }
  },
  {
    "schemaVersion": 1,
    "id": "field-controlled",
    "name": "Controlled",
    "dataType": "boolean",
    "multiplicity": "one",
    "validation": {}
  },
  {
    "schemaVersion": 1,
    "id": "field-reviewers",
    "name": "Reviewers",
    "dataType": "user",
    "multiplicity": "many",
    "maxValues": 3,
    "validation": {}
  }
]
```

`metadata-schemas.json` carries a required entry, a default, and a fixed entry with its default:

```json
[
  {
    "schemaVersion": 1,
    "id": "schema-regulatory",
    "name": "Regulatory",
    "entries": [
      { "field": "field-study-number", "required": true, "fixed": false },
      { "field": "field-phase", "required": false, "default": "1", "fixed": false },
      { "field": "field-controlled", "required": true, "default": true, "fixed": true }
    ]
  },
  {
    "schemaVersion": 1,
    "id": "schema-review",
    "name": "Review",
    "entries": [
      { "field": "field-reviewers", "required": false, "fixed": false },
      { "field": "field-keywords", "required": false, "default": ["protocol"], "fixed": false },
      { "field": "field-effective-date", "required": false, "fixed": false },
      { "field": "field-review-time", "required": false, "fixed": false },
      { "field": "field-approved-at", "required": false, "fixed": false },
      { "field": "field-dose", "required": false, "fixed": false }
    ]
  }
]
```

`component-types.json` carries a type whose assignment requires a field, and a type with none:

```json
[
  {
    "schemaVersion": 1,
    "id": "type-protocol-section",
    "name": "Protocol section",
    "assignments": [
      { "schema": "schema-regulatory", "requires": [] },
      { "schema": "schema-review", "requires": ["field-reviewers"] }
    ]
  },
  {
    "schemaVersion": 1,
    "id": "type-untyped",
    "name": "Untyped",
    "assignments": []
  }
]
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/domain/src/metadata/migrate.test.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFINITION_SCHEMA_VERSION } from './definition.js';
import { dataTypes, fieldDefinitionSchema } from './field.js';
import { migrateDefinition, readDefinition, type DefinitionKind } from './migrate.js';
import { checkSchema, metadataSchemaDefinitionSchema } from './schema.js';

const fixtures = join(import.meta.dirname, 'fixtures');

/** A fixture file holds every stored payload of one kind at one version. The name says which kind. */
const kindOf: Record<string, DefinitionKind> = {
  'fields.json': 'field',
  'metadata-schemas.json': 'metadataSchema',
  'component-types.json': 'componentType',
};

const load = (version: string, name: string): unknown[] =>
  JSON.parse(readFileSync(join(fixtures, version, name), 'utf8')) as unknown[];

describe('definition schema versions and migration', () => {
  it('MET-002 reads every definition fixture of every definition schema version at the current one', () => {
    const versions = readdirSync(fixtures);
    expect(versions.length).toBeGreaterThan(0);
    for (const version of versions) {
      const names = readdirSync(join(fixtures, version));
      expect(names.sort(), version).toEqual(Object.keys(kindOf).sort());
      for (const name of names) {
        const kind = kindOf[name];
        if (!kind) throw new Error(`${version}/${name} names no definition kind`);
        for (const [index, stored] of load(version, name).entries()) {
          const outcome = readDefinition(kind, stored, { artifact: name, version });
          expect(outcome, `${version}/${name}[${index}]`).toMatchObject({ ok: true });
          expect(migrateDefinition(kind, stored).schemaVersion).toBe(DEFINITION_SCHEMA_VERSION);
        }
      }
    }
  });

  it('MET-002 keeps a field fixture carrying every data type, multiplicity and validation member', () => {
    // As content's every-node fixture: the fixture earns its purpose only while something checks it.
    const fields = load('v1', 'fields.json') as {
      dataType: string;
      multiplicity: string;
      maxValues?: number;
      validation: Record<string, unknown>;
    }[];
    const found = new Set<string>();
    for (const field of fields) {
      found.add(field.dataType);
      found.add(field.multiplicity);
      if (field.maxValues !== undefined) found.add('maxValues');
      for (const member of Object.keys(field.validation)) found.add(`${field.dataType}.${member}`);
    }
    const missing = [
      ...dataTypes,
      'one',
      'many',
      'maxValues',
      'text.minLength',
      'text.maxLength',
      'number.min',
      'number.max',
      'number.integer',
      'number.scale',
      'date.min',
      'date.max',
      'time.min',
      'time.max',
      'dateTime.min',
      'dateTime.max',
    ].filter((each) => !found.has(each));
    expect(missing).toEqual([]);
  });

  it('MET-010 keeps a component type fixture with no assignments, since zero is allowed', () => {
    const types = load('v1', 'component-types.json') as { assignments: unknown[] }[];
    expect(types.some((type) => type.assignments.length === 0)).toBe(true);
  });

  it('MET-006 keeps schema fixtures whose every default passes its own field', () => {
    const fields = load('v1', 'fields.json').map((each) => fieldDefinitionSchema.parse(each));
    for (const stored of load('v1', 'metadata-schemas.json')) {
      const schema = metadataSchemaDefinitionSchema.parse(stored);
      expect(checkSchema(schema, fields), schema.id).toEqual([]);
    }
  });

  it('MET-002 refuses a definition schema version it has no path from, by number', () => {
    expect(() => migrateDefinition('field', { schemaVersion: 99 })).toThrow(/99/);
  });

  it('MET-002 refuses a definition that records no definition schema version', () => {
    expect(() => migrateDefinition('metadataSchema', { id: 'schema-reg' })).toThrow(
      /metadata schema definition records no schema version/,
    );
  });

  it('MET-017 reports a stored definition that will not parse, with its artifact and version, and yields nothing', () => {
    const outcome = readDefinition(
      'field',
      { schemaVersion: 1, id: 'field-x', name: 'X', dataType: 'colour', multiplicity: 'one' },
      { artifact: 'field-x', version: '7' },
    );
    expect(outcome).toMatchObject({ ok: false, artifact: 'field-x', version: '7' });
    expect(outcome).not.toHaveProperty('definition');
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain test -- src/metadata/migrate`
Expected: FAIL, the import `./migrate.js` does not resolve.

- [ ] **Step 4: Write the minimal implementation**

```ts
// packages/domain/src/metadata/migrate.ts
import { migrateStored, type MigrationChain } from '../stored/migrate.js';

import { componentTypeDefinitionSchema, type ComponentTypeDefinition } from './component-type.js';
import { DEFINITION_SCHEMA_VERSION } from './definition.js';
import { fieldDefinitionSchema, type FieldDefinition } from './field.js';
import { metadataSchemaDefinitionSchema, type MetadataSchemaDefinition } from './schema.js';

/** The three definition kinds, each an artifact kind versioned by the one mechanism (ADR-0024). */
export const definitionKinds = ['field', 'metadataSchema', 'componentType'] as const;

export type DefinitionKind = (typeof definitionKinds)[number];

export type DefinitionOf = {
  field: FieldDefinition;
  metadataSchema: MetadataSchemaDefinition;
  componentType: ComponentTypeDefinition;
};

/**
 * Empty while there is one definition schema version, for the reason content's chain is: the first
 * change is when a chain nobody built is found to be missing, and by then definitions are stored.
 */
const chains: Record<DefinitionKind, MigrationChain> = {
  field: { subject: 'field definition', current: DEFINITION_SCHEMA_VERSION, migrations: {} },
  metadataSchema: {
    subject: 'metadata schema definition',
    current: DEFINITION_SCHEMA_VERSION,
    migrations: {},
  },
  componentType: {
    subject: 'component type definition',
    current: DEFINITION_SCHEMA_VERSION,
    migrations: {},
  },
};

const parsers: { [K in DefinitionKind]: (value: unknown) => DefinitionOf[K] } = {
  field: (value) => fieldDefinitionSchema.parse(value),
  metadataSchema: (value) => metadataSchemaDefinitionSchema.parse(value),
  componentType: (value) => componentTypeDefinitionSchema.parse(value),
};

/** A stored definition at the current definition schema version. A projection, never a rewrite. */
export function migrateDefinition(kind: DefinitionKind, value: unknown): Record<string, unknown> {
  return migrateStored(value, chains[kind]);
}

export type DefinitionReadOutcome<K extends DefinitionKind> =
  | { ok: true; definition: DefinitionOf[K] }
  | { ok: false; artifact: string; version: string; failure: string };

/**
 * Read a stored definition: migrate it, then parse it. A definition that will not parse is reported
 * with its artifact and version, and yields nothing - the rule CNT-013 sets for content, applied to
 * the definitions content is validated against.
 */
export function readDefinition<K extends DefinitionKind>(
  kind: K,
  value: unknown,
  context: { artifact: string; version: string },
): DefinitionReadOutcome<K> {
  try {
    return { ok: true, definition: parsers[kind](migrateDefinition(kind, value)) };
  } catch (error) {
    return {
      ok: false,
      artifact: context.artifact,
      version: context.version,
      failure: error instanceof Error ? error.message : String(error),
    };
  }
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/domain test -- src/metadata/migrate`
Expected: PASS, 7 tests.

- [ ] **Step 6: Regenerate the trace and move the citation pin**

Run: `pnpm --filter @alloy-works/trace generate`, then in `packages/trace/src/trace.test.ts`:

```ts
expect(model.citations).toHaveLength(88);
```

- [ ] **Step 7: Run the gate**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format
```

Expected: every suite passes with no warnings.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/metadata/migrate.ts packages/domain/src/metadata/migrate.test.ts packages/domain/src/metadata/fixtures packages/trace/trace.json packages/trace/src/trace.test.ts
git commit -m "Migrate definitions on read, with a fixture per definition schema version"
```

---

## Task 7: Resolution

**Files:**

- Create: `packages/domain/src/metadata/resolve.ts`
- Modify: `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`
- Test: `packages/domain/src/metadata/resolve.test.ts`

**Interfaces:**

- Consumes: `type ComponentTypeDefinition`, `type MetadataSchemaDefinition`, `type FieldDefinition`,
  `type MetadataRule`, `checkValue`, `canonicalJson`
- Produces:
  `resolveComponentFields(type, schemas: readonly MetadataSchemaDefinition[], fields: readonly FieldDefinition[]): EffectiveField[]`,
  `type EffectiveField = { field; required; requiredBy: readonly string[]; fixed; fixedBy: readonly string[]; default?: { value: unknown; from: readonly string[] } }`,
  `class DefinitionConflictError extends Error { field: string; schemas: readonly string[]; rule: MetadataRule }`,
  constructed as `new DefinitionConflictError(field, schemas, rule, message)`

The rules are metadata.md's Resolution table. Three the Review settled: disagreeing defaults throw,
naming the field and the schemas; a `requires` naming a field its schema does not group is ignored, not
thrown; a requirement an assignment imposed is kept under the schema assigned.

**A default its field refuses throws too** (metadata.md, Resolution, as revised). Resolution runs
`checkValue` on every effective default against the field version it was given - once the defaults are
known to agree, so checking one checks them all - and throws, naming the field, every schema giving the
default and the rule that refused it. Without this a field version that tightens below a fixed default
would hand an author a value nobody can correct. Refusing that field version when it is saved is
MET-037's, which belongs to the undesigned definitions-management service, so no test here cites it.

**The error gains one member rather than a new kind.** Both cases are "a default resolution cannot
use", and the editor shows both the same way, as a definition problem. So `DefinitionConflictError`
keeps its name and its `field` and `schemas`, and gains `rule: MetadataRule`: `defaultConflict` (a rule
that already exists, for `checkAssignment`) when defaults disagree, and the refusing rule - `maxLength`,
`type`, `scale` and so on - when a field refuses the default. The caller builds the message, since the
two read differently.

**The two default tests are written together.** Step 1 includes both the existing disagreement test,
now also asserting `rule: 'defaultConflict'`, and the two new ones. Written first, the throw test fails
because nothing checks the default; the "resolves under the saved version" test passes from the start
and is there to show the check is against the version given, not a rule about the value.

**The stray test is ordered on purpose.** The schema whose `requires` is stray is assigned second, after
the schema that makes the field effective. Assigned first, the field would not yet be effective when
the stray is read, and the test would pass with the guard removed.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/metadata/resolve.test.ts
import { describe, expect, it } from 'vitest';

import { componentTypeDefinitionSchema } from './component-type.js';
import { DEFINITION_SCHEMA_VERSION } from './definition.js';
import { fieldDefinitionSchema } from './field.js';
import { DefinitionConflictError, resolveComponentFields } from './resolve.js';
import { metadataSchemaDefinitionSchema } from './schema.js';

const identity = (id: string) => ({ schemaVersion: DEFINITION_SCHEMA_VERSION, id, name: id });

const fieldOf = (id: string) =>
  fieldDefinitionSchema.parse({
    ...identity(id),
    dataType: 'text',
    multiplicity: 'one',
    validation: {},
  });

type Entry = { field: string; required: boolean; fixed: boolean; default?: unknown };

const entry = (field: string, overrides: Partial<Entry> = {}): Entry => ({
  field,
  required: false,
  fixed: false,
  ...overrides,
});

const schemaOf = (id: string, entries: Entry[]) =>
  metadataSchemaDefinitionSchema.parse({ ...identity(id), entries });

const typeOf = (assignments: { schema: string; requires: string[] }[]) =>
  componentTypeDefinitionSchema.parse({ ...identity('type-protocol'), assignments });

/** The error `run` throws. Fails the test when it throws nothing. */
const thrown = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('Expected resolution to throw, and it did not');
};

/** One field at two versions: saved with room for the default, later tightened below it. */
const studyAt = (maxLength: number) =>
  fieldDefinitionSchema.parse({
    ...identity('field-study'),
    dataType: 'text',
    multiplicity: 'one',
    validation: { maxLength },
  });

const study = fieldOf('field-study');
const phase = fieldOf('field-phase');
const site = fieldOf('field-site');
const fields = [study, phase, site];

describe('resolveComponentFields', () => {
  it('MET-007 applies a field reached through two schemas once, required if either requires it', () => {
    const regulatory = schemaOf('schema-reg', [entry('field-study', { required: true })]);
    const review = schemaOf('schema-review', [entry('field-study')]);
    const effective = resolveComponentFields(
      typeOf([
        { schema: 'schema-review', requires: [] },
        { schema: 'schema-reg', requires: [] },
      ]),
      [regulatory, review],
      fields,
    );
    expect(effective).toHaveLength(1);
    expect(effective[0]).toMatchObject({ required: true, requiredBy: ['schema-reg'] });
  });

  it('MET-007 orders fields by assignment, then entry, at their first occurrence', () => {
    const one = schemaOf('schema-one', [entry('field-phase'), entry('field-study')]);
    const two = schemaOf('schema-two', [entry('field-site'), entry('field-phase')]);
    const effective = resolveComponentFields(
      typeOf([
        { schema: 'schema-one', requires: [] },
        { schema: 'schema-two', requires: [] },
      ]),
      [two, one],
      fields,
    );
    expect(effective.map((each) => each.field.id)).toEqual([
      'field-phase',
      'field-study',
      'field-site',
    ]);
  });

  it('MET-009 lets an assignment make an optional field required, naming the schema assigned', () => {
    const regulatory = schemaOf('schema-reg', [entry('field-study')]);
    const [effective] = resolveComponentFields(
      typeOf([{ schema: 'schema-reg', requires: ['field-study'] }]),
      [regulatory],
      fields,
    );
    expect(effective).toMatchObject({ required: true, requiredBy: ['schema-reg'] });
  });

  it('MET-009 cannot make a required field optional, change a default or unfix a value', () => {
    const regulatory = schemaOf('schema-reg', [
      entry('field-study', { required: true, fixed: true, default: 'S-1' }),
    ]);
    const [effective] = resolveComponentFields(
      typeOf([{ schema: 'schema-reg', requires: [] }]),
      [regulatory],
      fields,
    );
    expect(effective).toMatchObject({
      required: true,
      fixed: true,
      default: { value: 'S-1', from: ['schema-reg'] },
    });
  });

  it('MET-009 ignores a requires naming a field the assigned schema does not group', () => {
    const regulatory = schemaOf('schema-reg', [entry('field-study')]);
    const review = schemaOf('schema-review', [entry('field-phase')]);
    const schemas = [regulatory, review];
    const clean = resolveComponentFields(
      typeOf([
        { schema: 'schema-review', requires: [] },
        { schema: 'schema-reg', requires: [] },
      ]),
      schemas,
      fields,
    );
    const stray = resolveComponentFields(
      typeOf([
        // field-phase is already effective, through schema-review, and schema-reg does not group
        // it; field-site is grouped by nothing.
        { schema: 'schema-review', requires: [] },
        { schema: 'schema-reg', requires: ['field-phase', 'field-site'] },
      ]),
      schemas,
      fields,
    );
    expect(stray).toEqual(clean);
  });

  it('MET-013 takes the type and its definitions and nothing about any document', () => {
    expect(resolveComponentFields.length).toBe(3);
    const regulatory = schemaOf('schema-reg', [entry('field-study', { required: true })]);
    const type = typeOf([{ schema: 'schema-reg', requires: [] }]);
    // Two documents made from different templates reference one component: they ask the same question.
    expect(resolveComponentFields(type, [regulatory], fields)).toEqual(
      resolveComponentFields(type, [regulatory], fields),
    );
  });

  it('MET-010 resolves a type assigning no schema to no fields', () => {
    expect(resolveComponentFields(typeOf([]), [], fields)).toEqual([]);
  });

  it('MET-006 throws on disagreeing defaults, naming the field and every schema, rather than picking one', () => {
    const one = schemaOf('schema-one', [entry('field-phase', { default: '1' })]);
    const two = schemaOf('schema-two', [entry('field-phase', { default: '2' })]);
    const type = typeOf([
      { schema: 'schema-one', requires: [] },
      { schema: 'schema-two', requires: [] },
    ]);
    expect(() => resolveComponentFields(type, [one, two], fields)).toThrow(DefinitionConflictError);
    try {
      resolveComponentFields(type, [one, two], fields);
    } catch (error) {
      expect(error).toMatchObject({
        field: 'field-phase',
        schemas: ['schema-one', 'schema-two'],
        rule: 'defaultConflict',
      });
      expect((error as Error).message).toBe(
        'Field field-phase has different defaults in schemas schema-one and schema-two',
      );
    }
  });

  it('MET-006 accepts two schemas giving one default, and names both', () => {
    const one = schemaOf('schema-one', [entry('field-phase', { default: '1' })]);
    const two = schemaOf('schema-two', [entry('field-phase', { default: '1' })]);
    const [effective] = resolveComponentFields(
      typeOf([
        { schema: 'schema-one', requires: [] },
        { schema: 'schema-two', requires: [] },
      ]),
      [one, two],
      fields,
    );
    expect(effective?.default).toEqual({ value: '1', from: ['schema-one', 'schema-two'] });
  });

  it('MET-006 throws on a default its field version refuses, naming the field, the schemas and the rule', () => {
    const fixing = schemaOf('schema-reg', [
      entry('field-study', { default: 'S-123', fixed: true }),
    ]);
    const giving = schemaOf('schema-quality', [entry('field-study', { default: 'S-123' })]);
    const type = typeOf([
      { schema: 'schema-reg', requires: [] },
      { schema: 'schema-quality', requires: [] },
    ]);
    const error = thrown(() => resolveComponentFields(type, [fixing, giving], [studyAt(3)]));
    expect(error).toBeInstanceOf(DefinitionConflictError);
    expect(error).toMatchObject({
      field: 'field-study',
      schemas: ['schema-reg', 'schema-quality'],
      rule: 'maxLength',
    });
    expect((error as Error).message).toBe(
      'Field field-study refuses the default in schemas schema-reg and schema-quality: maxLength, Is longer than 3 characters',
    );
  });

  it('MET-017 resolves the same default under the field version it was saved against', () => {
    const fixing = schemaOf('schema-reg', [
      entry('field-study', { default: 'S-123', fixed: true }),
    ]);
    const [effective] = resolveComponentFields(
      typeOf([{ schema: 'schema-reg', requires: [] }]),
      [fixing],
      [studyAt(10)],
    );
    expect(effective).toMatchObject({
      fixed: true,
      default: { value: 'S-123', from: ['schema-reg'] },
    });
  });

  it('MET-017 refuses to resolve from definitions it was not given, naming what is missing', () => {
    const regulatory = schemaOf('schema-reg', [entry('field-study')]);
    expect(() =>
      resolveComponentFields(typeOf([{ schema: 'schema-reg', requires: [] }]), [], fields),
    ).toThrow(/schema-reg/);
    expect(() =>
      resolveComponentFields(typeOf([{ schema: 'schema-reg', requires: [] }]), [regulatory], []),
    ).toThrow(/field-study/);
  });

  it('MET-007 and MET-009 resolve every combination of required, fixed and default across two schemas', () => {
    const options: Omit<Entry, 'field'>[] = [];
    for (const required of [false, true]) {
      for (const fixed of [false, true]) {
        for (const value of [undefined, 'x', 'y']) {
          if (fixed && value === undefined) continue;
          options.push({ required, fixed, ...(value === undefined ? {} : { default: value }) });
        }
      }
    }
    let cases = 0;
    for (const a of options) {
      for (const b of options) {
        for (const requiresA of [false, true]) {
          for (const requiresB of [false, true]) {
            cases += 1;
            const label = JSON.stringify({ a, b, requiresA, requiresB });
            const schemas = [
              schemaOf('schema-a', [{ field: 'field-phase', ...a }]),
              schemaOf('schema-b', [{ field: 'field-phase', ...b }]),
            ];
            const type = typeOf([
              { schema: 'schema-a', requires: requiresA ? ['field-phase'] : [] },
              { schema: 'schema-b', requires: requiresB ? ['field-phase'] : [] },
            ]);
            const defaults = [
              ...(a.default === undefined ? [] : [{ value: a.default, schema: 'schema-a' }]),
              ...(b.default === undefined ? [] : [{ value: b.default, schema: 'schema-b' }]),
            ];
            if (defaults.length === 2 && a.default !== b.default) {
              expect(() => resolveComponentFields(type, schemas, fields), label).toThrow(
                DefinitionConflictError,
              );
              continue;
            }
            const effective = resolveComponentFields(type, schemas, fields);
            expect(effective, label).toHaveLength(1);
            const requiredBy = [
              ...(a.required || requiresA ? ['schema-a'] : []),
              ...(b.required || requiresB ? ['schema-b'] : []),
            ];
            const fixedBy = [...(a.fixed ? ['schema-a'] : []), ...(b.fixed ? ['schema-b'] : [])];
            expect(effective[0], label).toEqual({
              field: phase,
              required: requiredBy.length > 0,
              requiredBy,
              fixed: fixedBy.length > 0,
              fixedBy,
              ...(defaults[0] === undefined
                ? {}
                : {
                    default: {
                      value: defaults[0].value,
                      from: defaults.map((each) => each.schema),
                    },
                  }),
            });
          }
        }
      }
    }
    expect(cases).toBe(400);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain test -- src/metadata/resolve`
Expected: FAIL, the import `./resolve.js` does not resolve.

- [ ] **Step 3: Write the minimal implementation**

```ts
// packages/domain/src/metadata/resolve.ts
import { canonicalJson } from '../stored/canonical.js';

import { checkValue } from './check-value.js';
import type { ComponentTypeDefinition } from './component-type.js';
import type { MetadataRule } from './failure.js';
import type { FieldDefinition } from './field.js';
import type { MetadataSchemaDefinition } from './schema.js';

/**
 * One field as it applies to a component of a type (metadata.md, Resolution). The array
 * `resolveComponentFields` returns is in resolution order - assignment order, then entry order, first
 * occurrence - so the order is the array's rather than a member's.
 */
export type EffectiveField = {
  readonly field: FieldDefinition;
  /** Any entry says required, or any assignment lists the field in `requires`. */
  readonly required: boolean;
  /** Every schema that made it required: an entry by its schema, an assignment by the schema assigned. */
  readonly requiredBy: readonly string[];
  readonly fixed: boolean;
  readonly fixedBy: readonly string[];
  /** Absent when no entry declares one. `from` is every schema declaring it - all alike, or resolution threw. */
  readonly default?: { readonly value: unknown; readonly from: readonly string[] };
};

/**
 * A default resolution cannot use: entries that disagree about it (`rule` is `defaultConflict`), or a
 * default the field version it was given refuses (`rule` is the field's rule that refused it, such as
 * `maxLength`). Either is a definition problem for an administrator, never a validation failure for an
 * author. MET-008 and MET-035 would refuse the first upstream and MET-037 the second, and none of those
 * refusals is designed yet - so a resolver that picked a default silently, or applied one its field
 * refuses, would turn those gaps into wrong data, and for a fixed field into a value no author can
 * correct.
 */
export class DefinitionConflictError extends Error {
  readonly field: string;
  readonly schemas: readonly string[];
  readonly rule: MetadataRule;

  constructor(field: string, schemas: readonly string[], rule: MetadataRule, message: string) {
    super(message);
    this.name = 'DefinitionConflictError';
    this.field = field;
    this.schemas = schemas;
    this.rule = rule;
  }
}

type Draft = {
  field: FieldDefinition;
  requiredBy: string[];
  fixedBy: string[];
  defaults: { value: unknown; schema: string }[];
};

const addOnce = (list: string[], id: string) => {
  if (!list.includes(id)) list.push(id);
};

/**
 * The effective fields for a component of `type` (MET-007, MET-009, MET-013).
 *
 * Takes the type and the definitions at specific versions and nothing about any document, so no
 * document can contribute a field. Which versions is the caller's: current ones while authoring,
 * recorded ones when checking a stored version (MET-017).
 *
 * A `requires` naming a field the assigned schema does not group is ignored: `checkAssignment`
 * refuses one when it is saved, and a later schema version can still leave one behind. Nothing is
 * lost - a field is effective only through a schema entry, so the stray has no field to make required.
 */
export function resolveComponentFields(
  type: ComponentTypeDefinition,
  schemas: readonly MetadataSchemaDefinition[],
  fields: readonly FieldDefinition[],
): EffectiveField[] {
  const schemaById = new Map(schemas.map((schema) => [schema.id, schema]));
  const fieldById = new Map(fields.map((field) => [field.id, field]));
  const drafts = new Map<string, Draft>();

  for (const assignment of type.assignments) {
    const schema = schemaById.get(assignment.schema);
    if (!schema) {
      throw new Error(
        `Component type ${type.id} assigns schema ${assignment.schema}, which was not supplied`,
      );
    }
    for (const entry of schema.entries) {
      const field = fieldById.get(entry.field);
      if (!field) {
        throw new Error(`Schema ${schema.id} groups field ${entry.field}, which was not supplied`);
      }
      let draft = drafts.get(field.id);
      if (!draft) {
        draft = { field, requiredBy: [], fixedBy: [], defaults: [] };
        drafts.set(field.id, draft);
      }
      if (entry.required) addOnce(draft.requiredBy, schema.id);
      if (entry.fixed) addOnce(draft.fixedBy, schema.id);
      if (entry.default !== undefined)
        draft.defaults.push({ value: entry.default, schema: schema.id });
    }
    const grouped = new Set(schema.entries.map((entry) => entry.field));
    for (const id of assignment.requires) {
      const draft = drafts.get(id);
      if (grouped.has(id) && draft) addOnce(draft.requiredBy, schema.id);
    }
  }

  return [...drafts.values()].map(toEffective);
}

function toEffective(draft: Draft): EffectiveField {
  const base = {
    field: draft.field,
    required: draft.requiredBy.length > 0,
    requiredBy: draft.requiredBy,
    fixed: draft.fixedBy.length > 0,
    fixedBy: draft.fixedBy,
  };
  const [first] = draft.defaults;
  if (!first) return base;
  const schemas = draft.defaults.map((each) => each.schema);
  const distinct = new Set(draft.defaults.map((each) => canonicalJson(each.value)));
  if (distinct.size > 1) {
    throw new DefinitionConflictError(
      draft.field.id,
      schemas,
      'defaultConflict',
      `Field ${draft.field.id} has different defaults in schemas ${schemas.join(' and ')}`,
    );
  }
  // The defaults agree, so checking one checks them all - against the field version this resolution
  // was given, which need not be the version the schema's default was saved against.
  const [refused] = checkValue(draft.field, first.value);
  if (refused) {
    throw new DefinitionConflictError(
      draft.field.id,
      schemas,
      refused.rule,
      `Field ${draft.field.id} refuses the default in schemas ${schemas.join(' and ')}: ${refused.rule}, ${refused.detail}`,
    );
  }
  return { ...base, default: { value: first.value, from: schemas } };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/domain test -- src/metadata/resolve`
Expected: PASS, 13 tests. The matrix test reports 400 cases.

- [ ] **Step 5: Prove the stray guard and the default check are tested**

Change `if (grouped.has(id) && draft)` to `if (draft)`, run the file, and watch
`MET-009 ignores a requires naming a field the assigned schema does not group` fail. Restore it.

Then change `if (refused)` so it never holds, run the file, and watch
`MET-006 throws on a default its field version refuses, naming the field, the schemas and the rule`
fail. Restore it.

- [ ] **Step 6: Regenerate the trace and move the citation pin**

Run: `pnpm --filter @alloy-works/trace generate`, then in `packages/trace/src/trace.test.ts`:

```ts
expect(model.citations).toHaveLength(94);
```

- [ ] **Step 7: Run the gate**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format
```

Expected: every suite passes with no warnings.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/metadata/resolve.ts packages/domain/src/metadata/resolve.test.ts packages/trace/trace.json packages/trace/src/trace.test.ts
git commit -m "Resolve a component type's effective fields, and throw on disagreeing defaults"
```

---

## Task 8: `checkAssignment`

**Files:**

- Create: `packages/domain/src/metadata/check-assignment.ts`
- Modify: `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`
- Test: `packages/domain/src/metadata/check-assignment.test.ts`

**Interfaces:**

- Consumes: `type Assignment`, `type MetadataSchemaDefinition`, `failure`, `sameValue`
- Produces:
  `checkAssignment(assigned: readonly MetadataSchemaDefinition[], candidate: { assignment: Assignment; schema: MetadataSchemaDefinition }): MetadataFailure[]`

It finds; it does not refuse. Refusing is MET-008's act, which belongs to the undesigned
definitions-management service, so the tests of default conflicts carry no identifier in their titles.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/metadata/check-assignment.test.ts
import { describe, expect, it } from 'vitest';

import { checkAssignment } from './check-assignment.js';
import { DEFINITION_SCHEMA_VERSION } from './definition.js';
import { metadataSchemaDefinitionSchema } from './schema.js';

const schemaOf = (id: string, entries: unknown[]) =>
  metadataSchemaDefinitionSchema.parse({
    schemaVersion: DEFINITION_SCHEMA_VERSION,
    id,
    name: id,
    entries,
  });

const regulatory = schemaOf('schema-reg', [
  { field: 'field-study', required: false, fixed: false },
  { field: 'field-phase', required: false, default: '1', fixed: false },
]);

describe('checkAssignment', () => {
  it('MET-009 refuses a requires naming a field the assigned schema does not group', () => {
    expect(
      checkAssignment([], {
        assignment: { schema: 'schema-reg', requires: ['field-study', 'field-stduy'] },
        schema: regulatory,
      }),
    ).toEqual([
      {
        code: 'metadata.requires',
        field: 'field-stduy',
        rule: 'requires',
        schemas: ['schema-reg'],
        detail: 'Schema schema-reg does not group this field',
      },
    ]);
  });

  it('MET-009 accepts a requires naming only fields the schema groups', () => {
    expect(
      checkAssignment([], {
        assignment: { schema: 'schema-reg', requires: ['field-study', 'field-phase'] },
        schema: regulatory,
      }),
    ).toEqual([]);
  });

  it('finds a default the candidate shares with an assigned schema and disagrees with, naming both', () => {
    const review = schemaOf('schema-review', [
      { field: 'field-phase', required: false, default: '2', fixed: false },
    ]);
    expect(
      checkAssignment([review], {
        assignment: { schema: 'schema-reg', requires: [] },
        schema: regulatory,
      }),
    ).toEqual([
      {
        code: 'metadata.defaultConflict',
        field: 'field-phase',
        rule: 'defaultConflict',
        schemas: ['schema-review', 'schema-reg'],
        detail: 'Schemas schema-review and schema-reg give this field different defaults',
      },
    ]);
  });

  it('finds no conflict where shared defaults agree, or only one schema gives one', () => {
    const agreeing = schemaOf('schema-agree', [
      { field: 'field-phase', required: true, default: '1', fixed: false },
    ]);
    const silent = schemaOf('schema-silent', [
      { field: 'field-phase', required: false, fixed: false },
    ]);
    expect(
      checkAssignment([agreeing, silent], {
        assignment: { schema: 'schema-reg', requires: [] },
        schema: regulatory,
      }),
    ).toEqual([]);
  });

  it('refuses a candidate whose assignment names a different schema from the one supplied', () => {
    expect(() =>
      checkAssignment([], {
        assignment: { schema: 'schema-other', requires: [] },
        schema: regulatory,
      }),
    ).toThrow(/schema-other/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain test -- src/metadata/check-assignment`
Expected: FAIL, the import `./check-assignment.js` does not resolve.

- [ ] **Step 3: Write the minimal implementation**

```ts
// packages/domain/src/metadata/check-assignment.ts
import type { Assignment } from './component-type.js';
import { failure, type MetadataFailure } from './failure.js';
import type { MetadataSchemaDefinition } from './schema.js';
import { sameValue } from './values.js';

/**
 * The comparison run before an assignment is saved (metadata.md, Resolution): every field its
 * `requires` names that the candidate schema does not group, and every default the candidate shares
 * with a schema already assigned that disagrees with it. Returns every conflict; refusing the
 * assignment is the definitions-management service's act, which is not designed.
 */
export function checkAssignment(
  assigned: readonly MetadataSchemaDefinition[],
  candidate: { readonly assignment: Assignment; readonly schema: MetadataSchemaDefinition },
): MetadataFailure[] {
  const { assignment, schema } = candidate;
  if (assignment.schema !== schema.id) {
    throw new Error(
      `The assignment names schema ${assignment.schema}, and schema ${schema.id} was supplied`,
    );
  }
  const failures: MetadataFailure[] = [];

  const grouped = new Set(schema.entries.map((entry) => entry.field));
  for (const field of assignment.requires) {
    if (!grouped.has(field)) {
      failures.push(
        failure(field, 'requires', `Schema ${schema.id} does not group this field`, [schema.id]),
      );
    }
  }

  for (const entry of schema.entries) {
    if (entry.default === undefined) continue;
    for (const other of assigned) {
      if (other.id === schema.id) continue;
      const shared = other.entries.find((each) => each.field === entry.field);
      if (shared?.default === undefined || sameValue(shared.default, entry.default)) continue;
      failures.push(
        failure(
          entry.field,
          'defaultConflict',
          `Schemas ${other.id} and ${schema.id} give this field different defaults`,
          [other.id, schema.id],
        ),
      );
    }
  }
  return failures;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/domain test -- src/metadata/check-assignment`
Expected: PASS, 5 tests.

- [ ] **Step 5: Regenerate the trace and move the citation pin**

Run: `pnpm --filter @alloy-works/trace generate`, then in `packages/trace/src/trace.test.ts`:

```ts
expect(model.citations).toHaveLength(95);
```

- [ ] **Step 6: Run the gate**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format
```

Expected: every suite passes with no warnings.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/metadata/check-assignment.ts packages/domain/src/metadata/check-assignment.test.ts packages/trace/trace.json packages/trace/src/trace.test.ts
git commit -m "Find an assignment's stray requires and conflicting defaults before it is saved"
```

---

## Task 9: `validate`

**Files:**

- Create: `packages/domain/src/metadata/validate.ts`
- Modify: `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`
- Test: `packages/domain/src/metadata/validate.test.ts`

**Interfaces:**

- Consumes: `checkValue`, `failure`, `type EffectiveField`, `hasMember`, `isClear`, `sameValue`
- Produces: `validate(effective: readonly EffectiveField[], values: MetadataValues): MetadataFailure[]`

Two rules come from schemas and name every schema that imposed them; every other rule is the field's,
through `checkValue`, and names none. The test's two schemas share two fields so that "every schema" is
demonstrated with more than one.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/metadata/validate.test.ts
import { describe, expect, it } from 'vitest';

import { componentTypeDefinitionSchema } from './component-type.js';
import { DEFINITION_SCHEMA_VERSION } from './definition.js';
import { fieldDefinitionSchema, type FieldDefinition } from './field.js';
import { resolveComponentFields } from './resolve.js';
import { metadataSchemaDefinitionSchema } from './schema.js';
import { validate } from './validate.js';

/** A copy of `value` without `member`, for a test that a member is required. */
const without = (value: Record<string, unknown>, member: string) =>
  Object.fromEntries(Object.entries(value).filter(([key]) => key !== member));

const identity = (id: string, name = id) => ({
  schemaVersion: DEFINITION_SCHEMA_VERSION,
  id,
  name,
});

const fieldOf = (
  id: string,
  name: string,
  shape: Record<string, unknown> = { dataType: 'text', multiplicity: 'one', validation: {} },
): FieldDefinition => fieldDefinitionSchema.parse({ ...identity(id, name), ...shape });

const study = fieldOf('field-study', 'Study number', {
  dataType: 'text',
  multiplicity: 'one',
  validation: { maxLength: 8 },
});
const sites = fieldOf('field-sites', 'Sites', {
  dataType: 'text',
  multiplicity: 'many',
  maxValues: 2,
  validation: {},
});
const controlled = fieldOf('field-controlled', 'Controlled', {
  dataType: 'boolean',
  multiplicity: 'one',
  validation: {},
});
const markets = fieldOf('field-markets', 'Markets', {
  dataType: 'text',
  multiplicity: 'many',
  validation: {},
});
const fields = [study, sites, controlled, markets];

const schemaOf = (id: string, entries: unknown[]) =>
  metadataSchemaDefinitionSchema.parse({ ...identity(id), entries });

const typeOf = (assignments: { schema: string; requires: string[] }[]) =>
  componentTypeDefinitionSchema.parse({ ...identity('type-protocol'), assignments });

const regulatory = schemaOf('schema-reg', [
  { field: 'field-study', required: true, fixed: false },
  { field: 'field-controlled', required: false, default: true, fixed: true },
  { field: 'field-markets', required: false, default: ['uk', 'us'], fixed: true },
]);
const quality = schemaOf('schema-quality', [
  { field: 'field-study', required: false, fixed: false },
  { field: 'field-sites', required: false, fixed: false },
  { field: 'field-controlled', required: true, default: true, fixed: true },
]);

const effective = resolveComponentFields(
  typeOf([
    { schema: 'schema-reg', requires: [] },
    { schema: 'schema-quality', requires: ['field-study', 'field-sites'] },
  ]),
  [regulatory, quality],
  fields,
);

const valid = {
  'field-study': 'S-1',
  'field-sites': ['Leeds'],
  'field-controlled': true,
  'field-markets': ['uk', 'us'],
};

const codes = (values: Record<string, unknown>) => validate(effective, values).map((f) => f.code);

describe('validate', () => {
  it('MET-022 passes a set of values that breaks no rule', () => {
    expect(validate(effective, valid)).toEqual([]);
  });

  it('MET-022 fails required for no member, naming every schema that requires the field', () => {
    expect(validate(effective, without(valid, 'field-study'))).toEqual([
      {
        code: 'metadata.required',
        field: 'field-study',
        rule: 'required',
        schemas: ['schema-reg', 'schema-quality'],
        detail: 'Study number is required',
      },
    ]);
  });

  it('MET-022 fails required for a clear: null on a one field and an empty list on a many field', () => {
    expect(codes({ ...valid, 'field-study': null })).toEqual(['metadata.required']);
    expect(codes({ ...valid, 'field-sites': [] })).toEqual(['metadata.required']);
  });

  it('MET-009 names the schema assigned when an assignment imposed the requirement', () => {
    expect(validate(effective, without(valid, 'field-sites'))).toEqual([
      expect.objectContaining({ code: 'metadata.required', schemas: ['schema-quality'] }),
    ]);
  });

  it('MET-030 makes required mean at least one value on a many field', () => {
    expect(codes({ ...valid, 'field-sites': ['Leeds'] })).toEqual([]);
    expect(codes({ ...valid, 'field-sites': [] })).toEqual(['metadata.required']);
  });

  it('MET-022 fails fixed for a value other than the default, naming every schema that fixes the field', () => {
    expect(validate(effective, { ...valid, 'field-controlled': false })).toEqual([
      {
        code: 'metadata.fixed',
        field: 'field-controlled',
        rule: 'fixed',
        schemas: ['schema-reg', 'schema-quality'],
        detail: 'Controlled is fixed, and holds another value',
      },
    ]);
  });

  it('MET-006 fails fixed for a clear on a fixed field, null and an empty list alike', () => {
    expect(codes({ ...valid, 'field-controlled': null })).toEqual([
      'metadata.required',
      'metadata.fixed',
    ]);
    expect(codes({ ...valid, 'field-markets': [] })).toEqual(['metadata.fixed']);
  });

  it('MET-030 fails fixed for the default values in another order, since order is part of the value', () => {
    expect(codes({ ...valid, 'field-markets': ['us', 'uk'] })).toEqual(['metadata.fixed']);
  });

  it('MET-006 does not fail fixed for no member, which carrying forward fills', () => {
    expect(codes(without(valid, 'field-markets'))).toEqual([]);
  });

  it('MET-004 applies the field rules through validate, naming no schema for them', () => {
    const failures = validate(effective, {
      ...valid,
      'field-study': 'S-123456789',
      'field-sites': ['Leeds', 'York', 'Leeds'],
      'field-controlled': 'yes',
    });
    expect(failures.map((f) => [f.code, f.schemas])).toEqual([
      // In resolution order: Regulatory's study and controlled, then Quality's sites.
      ['metadata.maxLength', []],
      ['metadata.fixed', ['schema-reg', 'schema-quality']],
      ['metadata.type', []],
      ['metadata.maxValues', []],
      ['metadata.multiplicity', []],
    ]);
  });

  it('MET-022 returns every failure, not the first', () => {
    expect(codes({})).toEqual(['metadata.required', 'metadata.required', 'metadata.required']);
  });

  it('MET-036 does not fail a value whose field is not effective', () => {
    expect(codes({ ...valid, 'field-retired': 42 })).toEqual([]);
  });

  it('MET-017 validates against the definition versions it is given, not the current ones', () => {
    // The version was written when Regulatory required nothing; Regulatory has since required sites.
    const recorded = schemaOf('schema-reg', [
      { field: 'field-sites', required: false, fixed: false },
    ]);
    const current = schemaOf('schema-reg', [
      { field: 'field-sites', required: true, fixed: false },
    ]);
    const type = typeOf([{ schema: 'schema-reg', requires: [] }]);
    const stored = {};
    expect(validate(resolveComponentFields(type, [recorded], fields), stored)).toEqual([]);
    expect(
      validate(resolveComponentFields(type, [current], fields), stored).map((f) => f.code),
    ).toEqual(['metadata.required']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain test -- src/metadata/validate`
Expected: FAIL, the import `./validate.js` does not resolve.

- [ ] **Step 3: Write the minimal implementation**

```ts
// packages/domain/src/metadata/validate.ts
import { checkValue } from './check-value.js';
import { failure, type MetadataFailure } from './failure.js';
import type { EffectiveField } from './resolve.js';
import { hasMember, isClear, sameValue, type MetadataValues } from './values.js';

/**
 * Every failure of `values` against `effective`, never the first (metadata.md, Validation).
 *
 * Two rules come from schemas and name every schema that imposed them: `required` - no member, `null`
 * or `[]` - and `fixed` - a value that differs from the default, a clear included. Every other rule is
 * the field's own, through `checkValue`, and names no schema (MET-004).
 *
 * A value whose field is not effective is not a failure: it is a value carrying forward will not
 * carry, and the caller shows it as that (MET-036).
 *
 * Takes the effective fields it is given. Checking a stored version resolves them from the definition
 * versions that version recorded, never the current ones (MET-017).
 */
export function validate(
  effective: readonly EffectiveField[],
  values: MetadataValues,
): MetadataFailure[] {
  const failures: MetadataFailure[] = [];
  for (const each of effective) {
    const id = each.field.id;
    const present = hasMember(values, id);
    const value = values[id];
    if (each.required && (!present || isClear(value))) {
      failures.push(failure(id, 'required', `${each.field.name} is required`, each.requiredBy));
    }
    if (present && each.fixed && each.default && !sameValue(value, each.default.value)) {
      failures.push(
        failure(id, 'fixed', `${each.field.name} is fixed, and holds another value`, each.fixedBy),
      );
    }
    if (present) failures.push(...checkValue(each.field, value));
  }
  return failures;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/domain test -- src/metadata/validate`
Expected: PASS, 13 tests.

- [ ] **Step 5: Prove `required` and `fixed` are each tested**

Comment out the `required` push, run the file, watch the required tests fail; restore. Do the same for
`fixed`, and for the `isClear(value)` half of `required` alone (the null and empty-list test must fail).

- [ ] **Step 6: Regenerate the trace and move the citation pin**

Run: `pnpm --filter @alloy-works/trace generate`, then in `packages/trace/src/trace.test.ts`:

```ts
expect(model.citations).toHaveLength(102);
```

- [ ] **Step 7: Run the gate**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format
```

Expected: every suite passes with no warnings.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/metadata/validate.ts packages/domain/src/metadata/validate.test.ts packages/trace/trace.json packages/trace/src/trace.test.ts
git commit -m "Validate values against effective fields, naming the schemas behind each rule"
```

---

## Task 10: User values

**Files:**

- Create: `packages/domain/src/metadata/users.ts`
- Modify: `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`
- Test: `packages/domain/src/metadata/users.test.ts`

**Interfaces:**

- Consumes: `failure`, `type EffectiveField`, `hasMember`, `isUserValue`
- Produces: `type Principal = { active: boolean }`,
  `type PrincipalLookup = (id: string) => Principal | undefined`,
  `principalIdsIn(values, effective): string[]`,
  `checkUserValues(values: MetadataValues, effective: readonly EffectiveField[], principals: PrincipalLookup): MetadataFailure[]`

**An inactive principal passes** (metadata.md, User values, and the Review's fourth point). That is
MET-004's rule, and the test citing it is the one that passes a departed user. MET-029 stays unclaimed
by the design, so no title here names it. The directory in the test is a hand-written function, not a
mock.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/metadata/users.test.ts
import { describe, expect, it } from 'vitest';

import { componentTypeDefinitionSchema } from './component-type.js';
import { DEFINITION_SCHEMA_VERSION } from './definition.js';
import { fieldDefinitionSchema } from './field.js';
import { resolveComponentFields } from './resolve.js';
import { metadataSchemaDefinitionSchema } from './schema.js';
import { checkUserValues, principalIdsIn, type PrincipalLookup } from './users.js';

const identity = (id: string) => ({ schemaVersion: DEFINITION_SCHEMA_VERSION, id, name: id });

const owner = fieldDefinitionSchema.parse({
  ...identity('field-owner'),
  dataType: 'user',
  multiplicity: 'one',
  validation: {},
});
const reviewers = fieldDefinitionSchema.parse({
  ...identity('field-reviewers'),
  dataType: 'user',
  multiplicity: 'many',
  validation: {},
});
const effective = resolveComponentFields(
  componentTypeDefinitionSchema.parse({
    ...identity('type-protocol'),
    assignments: [{ schema: 'schema-people', requires: [] }],
  }),
  [
    metadataSchemaDefinitionSchema.parse({
      ...identity('schema-people'),
      entries: [
        { field: 'field-owner', required: false, fixed: false },
        { field: 'field-reviewers', required: false, fixed: false },
      ],
    }),
  ],
  [owner, reviewers],
);

/** A hand-written directory: Ada is active, Grace has left, and nobody else exists here. */
const directory: PrincipalLookup = (id) =>
  ({ 'user-ada': { active: true }, 'user-grace': { active: false } })[id];

describe('checkUserValues', () => {
  it('MET-004 passes a principal of this tenant whether or not they are still active', () => {
    expect(
      checkUserValues(
        {
          'field-owner': { user: 'user-grace' },
          'field-reviewers': [{ user: 'user-ada' }, { user: 'user-grace' }],
        },
        effective,
        directory,
      ),
    ).toEqual([]);
  });

  it('MET-022 fails metadata.user for an identifier the lookup cannot see, naming the field', () => {
    expect(
      checkUserValues(
        {
          'field-owner': { user: 'user-alice' },
          'field-reviewers': [{ user: 'user-ada' }, { user: 'user-from-elsewhere' }],
        },
        effective,
        directory,
      ),
    ).toEqual([
      {
        code: 'metadata.user',
        field: 'field-owner',
        rule: 'user',
        schemas: [],
        detail: 'Names no user of this organisation',
      },
      {
        code: 'metadata.user',
        field: 'field-reviewers',
        rule: 'user',
        schemas: [],
        detail: 'Value 2 names no user of this organisation',
      },
    ]);
  });

  it('MET-004 leaves a value that is not user-shaped to validate, and a clear alone', () => {
    expect(
      checkUserValues({ 'field-owner': 'user-alice', 'field-reviewers': [] }, effective, directory),
    ).toEqual([]);
    expect(checkUserValues({ 'field-owner': null }, effective, directory)).toEqual([]);
  });

  it('MET-036 does not look up a user value whose field is not effective', () => {
    const asked: string[] = [];
    const recording: PrincipalLookup = (id) => {
      asked.push(id);
      return undefined;
    };
    expect(
      checkUserValues({ 'field-retired': { user: 'user-alice' } }, effective, recording),
    ).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('MET-004 collects every distinct principal the values name, so the service loads them in one query', () => {
    expect(
      principalIdsIn(
        {
          'field-owner': { user: 'user-ada' },
          'field-reviewers': [{ user: 'user-grace' }, { user: 'user-ada' }, 'not-a-user'],
          'field-retired': { user: 'user-alice' },
        },
        effective,
      ),
    ).toEqual(['user-ada', 'user-grace']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain test -- src/metadata/users`
Expected: FAIL, the import `./users.js` does not resolve.

- [ ] **Step 3: Write the minimal implementation**

```ts
// packages/domain/src/metadata/users.ts
import { failure, type MetadataFailure } from './failure.js';
import type { EffectiveField } from './resolve.js';
import { hasMember, isUserValue, type MetadataValues } from './values.js';

/** What the lookup reports of a principal it can see. Whether it is active changes nothing here. */
export type Principal = { readonly active: boolean };

/**
 * The service's lookup over this tenant's directory. Undefined means no principal this tenant can see
 * - a mistyped identifier, or another tenant's, which a tenant-scoped lookup cannot see by construction.
 *
 * Synchronous, so this package stays free of I/O: the service collects the identifiers with
 * `principalIdsIn`, loads them in one query, and passes a lookup over what it loaded.
 */
export type PrincipalLookup = (id: string) => Principal | undefined;

function userElements(
  each: EffectiveField,
  values: MetadataValues,
): { value: unknown; index: number }[] {
  if (each.field.dataType !== 'user' || !hasMember(values, each.field.id)) return [];
  const value = values[each.field.id];
  const list = each.field.multiplicity === 'many' && Array.isArray(value) ? value : [value];
  return list.map((element: unknown, index) => ({ value: element, index }));
}

/** Every distinct principal identifier the user values of effective fields name, in order. */
export function principalIdsIn(
  values: MetadataValues,
  effective: readonly EffectiveField[],
): string[] {
  const ids = new Set<string>();
  for (const each of effective) {
    for (const { value } of userElements(each, values)) {
      if (isUserValue(value)) ids.add(value.user);
    }
  }
  return [...ids];
}

/**
 * Every `user` value that names no principal of this tenant fails `metadata.user` (metadata.md, User
 * values). **An inactive principal passes**: refusing only a newly entered departed user would make one
 * value valid on one component and invalid on another (MET-004), and refusing every departed user would
 * fail a value entered before its user left.
 *
 * Not part of `validate`, which takes the field and the value and nothing else, and runs at publish from
 * recorded definitions with no directory to hand. A value that is not user-shaped is `validate`'s
 * `metadata.type` failure, and is skipped here rather than reported twice.
 */
export function checkUserValues(
  values: MetadataValues,
  effective: readonly EffectiveField[],
  principals: PrincipalLookup,
): MetadataFailure[] {
  const failures: MetadataFailure[] = [];
  for (const each of effective) {
    const many = each.field.multiplicity === 'many';
    for (const { value, index } of userElements(each, values)) {
      if (!isUserValue(value) || principals(value.user) !== undefined) continue;
      const which = many ? `Value ${index + 1} names` : 'Names';
      failures.push(failure(each.field.id, 'user', `${which} no user of this organisation`));
    }
  }
  return failures;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/domain test -- src/metadata/users`
Expected: PASS, 5 tests.

- [ ] **Step 5: Regenerate the trace and move the citation pin**

Run: `pnpm --filter @alloy-works/trace generate`, then in `packages/trace/src/trace.test.ts`:

```ts
expect(model.citations).toHaveLength(105);
```

- [ ] **Step 6: Run the gate**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format
```

Expected: every suite passes with no warnings.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/metadata/users.ts packages/domain/src/metadata/users.test.ts packages/trace/trace.json packages/trace/src/trace.test.ts
git commit -m "Refuse a user value naming nobody in the organisation, and pass a departed user"
```

---

## Task 11: Carrying forward

**Files:**

- Create: `packages/domain/src/metadata/carry.ts`
- Modify: `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`
- Test: `packages/domain/src/metadata/carry.test.ts`

**Interfaces:**

- Consumes: `type EffectiveField`, `hasMember`, `isClear`; in the test, `resolveComponentFields` and
  `validate`
- Produces: `type NotCarried = { field: string; value: unknown }`,
  `type CarriedForward = { values: MetadataValues; notCarried: readonly NotCarried[] }`,
  `carryForward(values: MetadataValues, effective: readonly EffectiveField[]): CarriedForward`

**It never changes a value that is present.** A clear stays a clear, a field with no member takes its
default, and a present value on a fixed field that differs from the default stays for `validate` to
name. The property test is decision 7's hand-written generator: a thousand seeded cases asserting the
design's partition, that carried values are the very same values (`toBe`, and byte-identical through
`JSON.stringify`, which unlike the canonical form does not normalise), that the input is untouched, and
that nothing appears in the output except a default for a field with no member.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/metadata/carry.test.ts
import { describe, expect, it } from 'vitest';

import { carryForward } from './carry.js';
import { componentTypeDefinitionSchema } from './component-type.js';
import { DEFINITION_SCHEMA_VERSION } from './definition.js';
import { fieldDefinitionSchema, type FieldDefinition } from './field.js';
import { resolveComponentFields, type EffectiveField } from './resolve.js';
import { metadataSchemaDefinitionSchema } from './schema.js';
import { validate } from './validate.js';

const identity = (id: string) => ({ schemaVersion: DEFINITION_SCHEMA_VERSION, id, name: id });

const textField = (id: string, multiplicity: 'one' | 'many' = 'one'): FieldDefinition =>
  fieldDefinitionSchema.parse({ ...identity(id), dataType: 'text', multiplicity, validation: {} });

const effectiveOf = (
  field: FieldDefinition,
  options: { default?: unknown; fixedBy?: string[] } = {},
): EffectiveField => ({
  field,
  required: false,
  requiredBy: [],
  fixed: (options.fixedBy ?? []).length > 0,
  fixedBy: options.fixedBy ?? [],
  ...(options.default === undefined
    ? {}
    : { default: { value: options.default, from: options.fixedBy ?? ['schema-reg'] } }),
});

describe('carryForward', () => {
  it('MET-036 carries a value whose field still applies, unchanged, even when it is now invalid', () => {
    const study = effectiveOf(textField('field-study'));
    const invalid = { user: 'not text at all' };
    const { values, notCarried } = carryForward({ 'field-study': invalid }, [study]);
    expect(values['field-study']).toBe(invalid);
    expect(notCarried).toEqual([]);
  });

  it('MET-036 records every value whose field no longer applies, by field, and carries none of them', () => {
    const study = effectiveOf(textField('field-study'));
    const { values, notCarried } = carryForward(
      { 'field-study': 'S-1', 'field-site': 'Leeds', 'field-arm': ['A', 'B'] },
      [study],
    );
    expect(values).toEqual({ 'field-study': 'S-1' });
    expect(notCarried).toEqual([
      { field: 'field-arm', value: ['A', 'B'] },
      { field: 'field-site', value: 'Leeds' },
    ]);
  });

  it('MET-036 drops a clear whose field no longer applies, since it holds nothing to record', () => {
    expect(carryForward({ 'field-site': null, 'field-arm': [] }, [])).toEqual({
      values: {},
      notCarried: [],
    });
  });

  it('MET-006 fills a field with no member from its default, which is how a fixed field is filled', () => {
    const controlled = effectiveOf(textField('field-controlled'), {
      default: 'yes',
      fixedBy: ['schema-reg'],
    });
    const markets = effectiveOf(textField('field-markets', 'many'), { default: ['uk', 'us'] });
    const plain = effectiveOf(textField('field-note'));
    expect(carryForward({}, [controlled, markets, plain]).values).toEqual({
      'field-controlled': 'yes',
      'field-markets': ['uk', 'us'],
    });
  });

  it('MET-036 copies a default, so changing the values carried cannot change a definition', () => {
    const markets = effectiveOf(textField('field-markets', 'many'), { default: ['uk'] });
    const { values } = carryForward({}, [markets]);
    (values['field-markets'] as string[]).push('us');
    expect(markets.default?.value).toEqual(['uk']);
  });

  it('MET-036 keeps a clear: null on a one field and an empty list on a many field, each with a default', () => {
    const study = effectiveOf(textField('field-study'), { default: 'S-0' });
    const markets = effectiveOf(textField('field-markets', 'many'), { default: ['uk'] });
    expect(carryForward({ 'field-study': null, 'field-markets': [] }, [study, markets])).toEqual({
      values: { 'field-study': null, 'field-markets': [] },
      notCarried: [],
    });
  });

  it('MET-036 never replaces a present value on a fixed field, and validate names every schema fixing it', () => {
    const controlled = textField('field-controlled');
    const effective = resolveComponentFields(
      componentTypeDefinitionSchema.parse({
        ...identity('type-protocol'),
        assignments: [
          { schema: 'schema-reg', requires: [] },
          { schema: 'schema-quality', requires: [] },
        ],
      }),
      ['schema-reg', 'schema-quality'].map((id) =>
        metadataSchemaDefinitionSchema.parse({
          ...identity(id),
          entries: [{ field: 'field-controlled', required: false, default: 'yes', fixed: true }],
        }),
      ),
      [controlled],
    );
    const { values } = carryForward({ 'field-controlled': 'no' }, effective);
    expect(values).toEqual({ 'field-controlled': 'no' });
    expect(validate(effective, values)).toEqual([
      expect.objectContaining({
        code: 'metadata.fixed',
        schemas: ['schema-reg', 'schema-quality'],
      }),
    ]);
  });

  it('MET-036 treats a field whose identifier is __proto__ as a field like any other', () => {
    const odd = effectiveOf(textField('__proto__'), { default: 'x' });
    const { values } = carryForward({}, [odd]);
    expect(Object.keys(values)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
  });
});

/**
 * A hand-written generator rather than a property-testing library. Nothing in the workspace depends on
 * one, the property is a partition that needs no shrinking to diagnose - a failing case prints its seed
 * and its input whole - and a seeded generator runs the same cases on Windows and on Linux.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('carryForward, as a property', () => {
  const pick = <T>(random: () => number, from: readonly T[]): T =>
    from[Math.floor(random() * from.length)] as T;

  const candidates: readonly unknown[] = [
    null,
    [],
    'Ada',
    'caf\u00e9',
    '0.1',
    true,
    false,
    { user: 'user-grace' },
    ['uk', 'us'],
    [{ user: 'user-ada' }],
    42,
    { unexpected: 'shape' },
  ];
  const ids = ['field-a', 'field-b', 'field-c', 'field-d', 'field-e', 'field-f'];

  it('MET-036 carries or records every value but a clear exactly once, and carries each byte-identical', () => {
    const seed = 20260915;
    const random = seeded(seed);
    for (let run = 0; run < 1000; run += 1) {
      const values: Record<string, unknown> = {};
      for (const id of ids) if (random() < 0.6) values[id] = pick(random, candidates);
      const effective = ids
        .filter(() => random() < 0.5)
        .map((id) =>
          effectiveOf(
            textField(id),
            random() < 0.4 ? { default: pick(random, ['S-0', true]) } : {},
          ),
        );
      const effectiveIds = new Set(effective.map((each) => each.field.id));
      const label = `seed ${seed}, run ${run}: ${JSON.stringify({ values, effective: [...effectiveIds] })}`;

      const before = JSON.stringify(values);
      const result = carryForward(values, effective);
      expect(JSON.stringify(values), `${label} input unchanged`).toBe(before);

      for (const [id, value] of Object.entries(values)) {
        const carried = Object.hasOwn(result.values, id);
        const recorded = result.notCarried.filter((each) => each.field === id);
        const clear = value === null || (Array.isArray(value) && value.length === 0);
        if (effectiveIds.has(id)) {
          // Present on an effective field, clear or not: carried, and the very same value.
          expect(carried, label).toBe(true);
          expect(result.values[id], label).toBe(value);
          expect(JSON.stringify(result.values[id]), label).toBe(JSON.stringify(value));
          expect(recorded, label).toEqual([]);
        } else if (clear) {
          expect(carried || recorded.length > 0, `${label} a clear for ${id} is dropped`).toBe(
            false,
          );
        } else {
          expect(carried, label).toBe(false);
          expect(recorded, label).toHaveLength(1);
          expect(recorded[0]?.value, label).toBe(value);
        }
      }

      for (const id of Object.keys(result.values)) {
        if (Object.hasOwn(values, id)) continue;
        // Nothing appears that was not there, except a default for a field with no member.
        const field = effective.find((each) => each.field.id === id);
        expect(field?.default, `${label} ${id} appeared from nowhere`).toBeDefined();
        expect(result.values[id], label).toEqual(field?.default?.value);
      }
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain test -- src/metadata/carry`
Expected: FAIL, the import `./carry.js` does not resolve.

- [ ] **Step 3: Write the minimal implementation**

```ts
// packages/domain/src/metadata/carry.ts
import type { EffectiveField } from './resolve.js';
import { hasMember, isClear, type MetadataValues } from './values.js';

/** A value the next version does not carry, by field, which the version records in full (MET-036). */
export type NotCarried = { readonly field: string; readonly value: unknown };

export type CarriedForward = {
  readonly values: MetadataValues;
  /** Sorted by field identifier, in the order canonical serialisation sorts members. */
  readonly notCarried: readonly NotCarried[];
};

/**
 * What the next version holds (metadata.md, Carrying forward). **It never changes a value that is
 * present.**
 *
 * - Present, and its field is effective: carried unchanged, even if it is now invalid.
 * - Present, and its field is not effective: in `notCarried`.
 * - A clear for a field that is not effective: dropped, since it holds nothing to record.
 * - No member, and the field has a default: takes the default. This is how a fixed field is filled.
 * - No member, and no default: stays without one.
 *
 * A present value on a fixed field that differs from its default is not replaced. Replacing it would
 * turn a write that should have been refused into a silent change; it stays, and `validate` names it.
 */
export function carryForward(
  values: MetadataValues,
  effective: readonly EffectiveField[],
): CarriedForward {
  const effectiveIds = new Set(effective.map((each) => each.field.id));
  const carried: [string, unknown][] = [];
  const notCarried: NotCarried[] = [];

  for (const [field, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (effectiveIds.has(field)) carried.push([field, value]);
    else if (!isClear(value)) notCarried.push({ field, value });
  }
  for (const each of effective) {
    if (!hasMember(values, each.field.id) && each.default) {
      carried.push([each.field.id, structuredCopy(each.default.value)]);
    }
  }

  notCarried.sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0));
  // `Object.fromEntries` defines each member, so a field whose identifier is `__proto__` is a member
  // like any other rather than a prototype assignment.
  return { values: Object.fromEntries(carried), notCarried };
}

/** A default is copied, so a caller mutating the values it was handed cannot change a definition. */
function structuredCopy(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/domain test -- src/metadata/carry`
Expected: PASS, 9 tests.

- [ ] **Step 5: Prove the property catches a replacement**

Change the first loop to push `each.default.value` for an effective field that has a default, whatever
the member holds (the unconditional reset the Review removed). Run the file and watch the clears test,
the fixed test and the property test fail. Restore it.

- [ ] **Step 6: Regenerate the trace and move the citation pin**

Run: `pnpm --filter @alloy-works/trace generate`, then in `packages/trace/src/trace.test.ts`:

```ts
expect(model.citations).toHaveLength(107);
```

- [ ] **Step 7: Run the gate**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format
```

Expected: every suite passes with no warnings.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/metadata/carry.ts packages/domain/src/metadata/carry.test.ts packages/trace/trace.json packages/trace/src/trace.test.ts
git commit -m "Carry values forward without ever changing one that is present"
```

---

## Task 12: What a version records

**Files:**

- Create: `packages/domain/src/metadata/record.ts`
- Modify: `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`
- Test: `packages/domain/src/metadata/record.test.ts`

**Interfaces:**

- Consumes: `canonicalJson`, `type NotCarried`, the three definition types, `type DefinitionKind`; in
  the test, `resolveComponentFields`, `carryForward`, `validate`
- Produces: `type Versioned<T> = { version: string; definition: T }`,
  `type DefinitionRef = { kind: DefinitionKind; id: string; version: string }`,
  `definitionsFor(type: Versioned<ComponentTypeDefinition>, schemas: readonly Versioned<MetadataSchemaDefinition>[], fields: readonly Versioned<FieldDefinition>[]): DefinitionRef[]`,
  `canonicaliseValues(values: MetadataValues): string`,
  `canonicaliseNotCarried(notCarried: readonly NotCarried[]): string`

`definitionsFor` is what the service stamps into `version_definition` at promotion (MET-018), and the
two serialisations are the metadata members of the version digest (ADR-0024). MET-018's second test
runs the whole path a next version takes - resolve from current definitions, carry forward, validate -
and shows a newly required field asked for.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/metadata/record.test.ts
import { describe, expect, it } from 'vitest';

import { carryForward } from './carry.js';
import { componentTypeDefinitionSchema } from './component-type.js';
import { DEFINITION_SCHEMA_VERSION } from './definition.js';
import { fieldDefinitionSchema } from './field.js';
import { canonicaliseNotCarried, canonicaliseValues, definitionsFor } from './record.js';
import { resolveComponentFields } from './resolve.js';
import { metadataSchemaDefinitionSchema } from './schema.js';
import { validate } from './validate.js';

const identity = (id: string) => ({ schemaVersion: DEFINITION_SCHEMA_VERSION, id, name: id });

const fieldOf = (id: string) =>
  fieldDefinitionSchema.parse({
    ...identity(id),
    dataType: 'text',
    multiplicity: 'one',
    validation: {},
  });

const schemaOf = (id: string, entries: unknown[]) =>
  metadataSchemaDefinitionSchema.parse({ ...identity(id), entries });

const type = componentTypeDefinitionSchema.parse({
  ...identity('type-protocol'),
  assignments: [
    { schema: 'schema-reg', requires: [] },
    { schema: 'schema-quality', requires: [] },
  ],
});

describe('definitionsFor', () => {
  const regulatory = schemaOf('schema-reg', [
    { field: 'field-study', required: true, fixed: false },
    { field: 'field-site', required: false, fixed: false },
  ]);
  const quality = schemaOf('schema-quality', [
    { field: 'field-site', required: false, fixed: false },
  ]);

  it('MET-018 names the type, each schema it assigns and each field those group, and nothing else', () => {
    expect(
      definitionsFor(
        { version: 'v-type-3', definition: type },
        [
          { version: 'v-quality-1', definition: quality },
          { version: 'v-reg-7', definition: regulatory },
          { version: 'v-unused-2', definition: schemaOf('schema-unused', []) },
        ],
        [
          { version: 'v-site-2', definition: fieldOf('field-site') },
          { version: 'v-study-5', definition: fieldOf('field-study') },
          { version: 'v-other-1', definition: fieldOf('field-other') },
        ],
      ),
    ).toEqual([
      { kind: 'componentType', id: 'type-protocol', version: 'v-type-3' },
      { kind: 'field', id: 'field-site', version: 'v-site-2' },
      { kind: 'field', id: 'field-study', version: 'v-study-5' },
      { kind: 'metadataSchema', id: 'schema-quality', version: 'v-quality-1' },
      { kind: 'metadataSchema', id: 'schema-reg', version: 'v-reg-7' },
    ]);
  });

  it('MET-017 refuses to name a definition it was not given, and one given at two versions', () => {
    expect(() => definitionsFor({ version: 't', definition: type }, [], [])).toThrow(/schema-reg/);
    expect(() =>
      definitionsFor(
        { version: 't', definition: type },
        [
          { version: 'a', definition: regulatory },
          { version: 'b', definition: regulatory },
          { version: 'c', definition: quality },
        ],
        [],
      ),
    ).toThrow(/Two versions of schema schema-reg/);
  });

  it('MET-018 asks for a field newly made required the next time the component is written', () => {
    // Written when Regulatory required nothing; Regulatory's current version requires the site.
    const stored = { 'field-study': 'S-1' };
    const current = schemaOf('schema-reg', [
      { field: 'field-study', required: true, fixed: false },
      { field: 'field-site', required: true, fixed: false },
    ]);
    const effective = resolveComponentFields(
      type,
      [current, quality],
      [fieldOf('field-study'), fieldOf('field-site')],
    );
    const next = carryForward(stored, effective);
    expect(validate(effective, next.values)).toEqual([
      expect.objectContaining({ code: 'metadata.required', field: 'field-site' }),
    ]);
  });
});

describe('the canonical form of values and of what was not carried', () => {
  it('MET-036 serialises values alike whatever order their members were written in', () => {
    expect(canonicaliseValues({ 'field-b': 'Grace', 'field-a': 'Ada' })).toBe(
      canonicaliseValues({ 'field-a': 'Ada', 'field-b': 'Grace' }),
    );
    expect(canonicaliseValues({ 'field-b': 'Grace', 'field-a': 'Ada' })).toBe(
      '{"field-a":"Ada","field-b":"Grace"}',
    );
  });

  it('MET-030 keeps a many value in its order, even for a field whose identifier is marks', () => {
    expect(canonicaliseValues({ marks: ['us', 'uk'] })).toBe('{"marks":["us","uk"]}');
    expect(canonicaliseValues({ 'field-m': ['us', 'uk'] })).not.toBe(
      canonicaliseValues({ 'field-m': ['uk', 'us'] }),
    );
  });

  it('MET-030 normalises text to NFC, so one value typed two ways serialises once', () => {
    expect(canonicaliseValues({ 'field-a': 'cafe\u0301' })).toBe(
      canonicaliseValues({ 'field-a': 'caf\u00e9' }),
    );
  });

  it('MET-002 round-trips a decimal string a float would corrupt, byte for byte', () => {
    const values = {
      'field-dose': '0.1000000000000000055',
      'field-count': '9007199254740993',
      'field-rate': '1234567890.123456789012',
    };
    const parsed = JSON.parse(canonicaliseValues(values)) as Record<string, string>;
    expect(parsed).toEqual(values);
    for (const value of Object.values(values)) expect(String(Number(value))).not.toBe(value);
  });

  it('MET-036 keeps a clear distinct from no member in the serialisation', () => {
    expect(canonicaliseValues({ 'field-a': null })).not.toBe(canonicaliseValues({}));
    expect(canonicaliseValues({ 'field-a': [] })).not.toBe(canonicaliseValues({}));
  });

  it('MET-036 serialises what was not carried by field, whatever order it was listed in', () => {
    const listed = [
      { field: 'field-b', value: 'Grace' },
      { field: 'field-a', value: ['x', 'y'] },
    ];
    expect(canonicaliseNotCarried(listed)).toBe(canonicaliseNotCarried([...listed].reverse()));
    expect(canonicaliseNotCarried(listed)).toBe(
      '[{"field":"field-a","value":["x","y"]},{"field":"field-b","value":"Grace"}]',
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain test -- src/metadata/record`
Expected: FAIL, the import `./record.js` does not resolve.

- [ ] **Step 3: Write the minimal implementation**

```ts
// packages/domain/src/metadata/record.ts
import { canonicalJson } from '../stored/canonical.js';

import type { NotCarried } from './carry.js';
import type { ComponentTypeDefinition } from './component-type.js';
import type { FieldDefinition } from './field.js';
import type { DefinitionKind } from './migrate.js';
import type { MetadataSchemaDefinition } from './schema.js';
import type { MetadataValues } from './values.js';

/**
 * A definition at a version. `version` is opaque here: it is whatever identifies the artifact version
 * row, which the service loaded the payload from and which `version_definition` points at.
 */
export type Versioned<T> = { readonly version: string; readonly definition: T };

export type DefinitionRef = {
  readonly kind: DefinitionKind;
  readonly id: string;
  readonly version: string;
};

/**
 * The definition versions a component's next version is written against (MET-018): the type, each
 * schema it assigns, and each field those schemas group - and nothing else it was handed. The service
 * passes the current versions, and stamps the list on the version at promotion (MET-017).
 *
 * Sorted by kind, then identifier, then version, because the definitions a version records are a set
 * and the version digest serialises them in one order (ADR-0024).
 */
export function definitionsFor(
  type: Versioned<ComponentTypeDefinition>,
  schemas: readonly Versioned<MetadataSchemaDefinition>[],
  fields: readonly Versioned<FieldDefinition>[],
): DefinitionRef[] {
  const schemaById = byId(schemas, 'schema');
  const fieldById = byId(fields, 'field');
  const refs = new Map<string, DefinitionRef>();
  const add = (kind: DefinitionKind, id: string, version: string) =>
    refs.set(`${kind}:${id}`, { kind, id, version });

  add('componentType', type.definition.id, type.version);
  for (const assignment of type.definition.assignments) {
    const schema = schemaById.get(assignment.schema);
    if (!schema) {
      throw new Error(
        `Component type ${type.definition.id} assigns schema ${assignment.schema}, which was not supplied`,
      );
    }
    add('metadataSchema', schema.definition.id, schema.version);
    for (const entry of schema.definition.entries) {
      const field = fieldById.get(entry.field);
      if (!field) {
        throw new Error(
          `Schema ${schema.definition.id} groups field ${entry.field}, which was not supplied`,
        );
      }
      add('field', field.definition.id, field.version);
    }
  }

  return [...refs.values()].sort(
    (a, b) => compare(a.kind, b.kind) || compare(a.id, b.id) || compare(a.version, b.version),
  );
}

function byId<T extends { readonly id: string }>(
  list: readonly Versioned<T>[],
  kind: string,
): Map<string, Versioned<T>> {
  const map = new Map<string, Versioned<T>>();
  for (const each of list) {
    if (map.has(each.definition.id)) {
      throw new Error(`Two versions of ${kind} ${each.definition.id} were supplied`);
    }
    map.set(each.definition.id, each);
  }
  return map;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The canonical serialisation of a version's metadata values, as the version digest takes them
 * (ADR-0024): content's rules - members in lexicographic order, strings in NFC, no insignificant
 * whitespace - and every array in the order given, since MET-030 makes the order part of a value.
 */
export function canonicaliseValues(values: MetadataValues): string {
  return canonicalJson(values);
}

/** The canonical serialisation of the values a version did not carry, sorted by field. */
export function canonicaliseNotCarried(notCarried: readonly NotCarried[]): string {
  return canonicalJson([...notCarried].sort((a, b) => compare(a.field, b.field)));
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/domain test -- src/metadata/record`
Expected: PASS, 9 tests.

- [ ] **Step 5: Regenerate the trace and move the citation pin**

Run: `pnpm --filter @alloy-works/trace generate`, then in `packages/trace/src/trace.test.ts`:

```ts
expect(model.citations).toHaveLength(112);
```

- [ ] **Step 6: Run the gate**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format
```

Expected: every suite passes with no warnings.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/metadata/record.ts packages/domain/src/metadata/record.test.ts packages/trace/trace.json packages/trace/src/trace.test.ts
git commit -m "Name the definitions a version is written against, and serialise its values"
```

---

## Task 13: Promote metadata to the package's public surface

**Files:**

- Create: `packages/domain/src/metadata/index.ts`
- Modify: `packages/domain/src/index.ts`, `packages/domain/src/index.test.ts`

**Interfaces:**

- Consumes: everything above
- Produces: the domain package's public surface. `stored/` and `lexical.ts`'s helpers other than
  `canonicaliseDecimal` stay internal: nothing outside the package needs them, and a surface is harder
  to take back than to give.

Promotion is a deliberate act, as it was for the content model. The service, the editor and the
publisher import these from `@alloy-works/domain` and nowhere else. No export name collides with the
scaffolding `Component` exports beside them (`componentTypes` is the scaffolding's, and stays).

- [ ] **Step 1: Write the failing test**

Replace `packages/domain/src/index.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';

import * as domain from './index.js';

describe('the domain package', () => {
  it('exports the content model and the metadata rules as its public surface', () => {
    expect(Object.keys(domain).sort()).toEqual(
      [
        // The content model, promoted deliberately rather than by drift.
        'CURRENT_SCHEMA_VERSION',
        'allowedLinkSchemes',
        'alternativeSchema',
        'blockNodeSchema',
        'canonicalise',
        'contentDocumentSchema',
        'inlineNodeSchema',
        'markSchema',
        'markTypes',
        'migrate',
        'outputMapping',
        'parseContentDocument',
        'readContent',
        // Metadata, promoted in the plan that built it, on the same terms.
        'DEFINITION_SCHEMA_VERSION',
        'DefinitionConflictError',
        'canonicaliseDecimal',
        'canonicaliseNotCarried',
        'canonicaliseValues',
        'carryForward',
        'checkAssignment',
        'checkSchema',
        'checkUserValues',
        'checkValue',
        'componentTypeDefinitionSchema',
        'dataTypes',
        'definitionKinds',
        'definitionsFor',
        'fieldDefinitionSchema',
        'metadataSchemaDefinitionSchema',
        'migrateDefinition',
        'principalIdsIn',
        'readDefinition',
        'resolveComponentFields',
        'validate',
        // Scaffolding, and not a decision about the content model. See CLAUDE.md.
        'componentSchema',
        'componentTypes',
        'createComponent',
        'nextVersion',
        'parseComponent',
      ].sort(),
    );
  });

  it('CNT-010 exposes one entry point that validates, and no way round it', () => {
    expect(typeof domain.parseContentDocument).toBe('function');
    expect(domain).not.toHaveProperty('unsafeParseContentDocument');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain test -- src/index`
Expected: FAIL, the exported keys do not match: the twenty-one metadata names are missing.

- [ ] **Step 3: Write the barrel and re-export it**

```ts
// packages/domain/src/metadata/index.ts
export { DEFINITION_SCHEMA_VERSION } from './definition.js';

export { dataTypes, fieldDefinitionSchema } from './field.js';
export type { DataType, FieldDefinition } from './field.js';

export { metadataSchemaDefinitionSchema, checkSchema } from './schema.js';
export type { MetadataSchemaDefinition, SchemaEntry } from './schema.js';

export { componentTypeDefinitionSchema } from './component-type.js';
export type { Assignment, ComponentTypeDefinition } from './component-type.js';

export { definitionKinds, migrateDefinition, readDefinition } from './migrate.js';
export type { DefinitionKind, DefinitionOf, DefinitionReadOutcome } from './migrate.js';

export { canonicaliseDecimal } from './lexical.js';
export type { MetadataFailure, MetadataRule } from './failure.js';
export type { MetadataValues, UserValue } from './values.js';

export { checkValue } from './check-value.js';
export { resolveComponentFields, DefinitionConflictError } from './resolve.js';
export type { EffectiveField } from './resolve.js';
export { checkAssignment } from './check-assignment.js';
export { validate } from './validate.js';
export { checkUserValues, principalIdsIn } from './users.js';
export type { Principal, PrincipalLookup } from './users.js';
export { carryForward } from './carry.js';
export type { CarriedForward, NotCarried } from './carry.js';
export { definitionsFor, canonicaliseValues, canonicaliseNotCarried } from './record.js';
export type { DefinitionRef, Versioned } from './record.js';
```

Replace `packages/domain/src/index.ts` with:

```ts
export * from './content/model/index.js';

// Metadata: which fields apply to a component, what makes a value valid, and what a version records.
export * from './metadata/index.js';

// Scaffolding. This is NOT the content model - see docs/design/content-model.md for that, and
// CLAUDE.md for why this exists. `apps/web` still uses it; retiring it is that app's change.
export {
  componentSchema,
  componentTypes,
  createComponent,
  parseComponent,
  nextVersion,
} from './component.js';

export type { Component, ComponentDraft, ComponentType } from './component.js';
```

- [ ] **Step 4: Build, and run the whole gate**

```bash
pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format
```

Expected: PASS. The build matters: `apps/web` and `apps/service` import the domain package's `dist/`, so
a broken barrel is a broken renderer or service rather than a failed unit test. The citation count
stays 112 - `index.test.ts` cites CNT-010, as it already did.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/metadata/index.ts packages/domain/src/index.ts packages/domain/src/index.test.ts
git commit -m "Promote the metadata rules to the domain package's public surface"
```

---

## Task 14: The trace, the docs and the release

**Files:**

- Modify: `packages/trace/src/trace.test.ts` (the pin's comment)
- Modify: `docs/architecture.md`
- Modify: `docs/plans/README.md`
- Modify: `CHANGELOG.md`, `version.json`, `package.json`, `apps/desktop/package.json`
- Not modified: `docs/features.md` and `README.md` - see step 6

- [ ] **Step 1: Say where the pin came from**

In `packages/trace/src/trace.test.ts`, above `expect(model.citations).toHaveLength(112);`, add:

```ts
// 112, from 61: the metadata rules (docs/plans/2026-09-15-metadata-01-the-rules.md) cite all fifteen
// requirements metadata.md owns across thirteen test files, and the canonical rules and migration
// chain the content model now shares cite CNT-011, CNT-012, CNT-056 and MET-030 in two more.
```

- [ ] **Step 2: Check the corpus and the claims**

```bash
pnpm --filter @alloy-works/trace generate
pnpm trace check
```

Expected: `No problems in the corpus.` A citation of a requirement no design claims fails here as
`cited-undesigned` - which is how a test citing MET-008 or MET-029 would be caught.

- [ ] **Step 3: Report what moved, and do not overstate it**

```bash
pnpm test
pnpm trace verify
pnpm trace stats
```

Expected, measured when this plan was written: `Covered` rises from 10 to 13 in Constraint (MET-013,
MET-017, MET-036) and from 40 to 52 in T1, and `pnpm trace verify` reports the fifteen MET requirements
as `Verified`. Each is verified in the sense the trace can prove - a test naming it passed - and in no
larger sense: nothing stores a value, shows a field or refuses a write yet. If `main` has moved, report
what the command says rather than these numbers.

- [ ] **Step 4: Pass the gate**

Run: `pnpm trace gate`
Expected: PASS. The baseline has not changed, so this proves only that the run it reads did not fail.

- [ ] **Step 5: Describe the metadata rules as built**

In `docs/architecture.md`:

Replace the status quote's first sentence with:

```markdown
> Status: scaffolding, plus the content model's stored shape and the metadata rules. The workspaces, the
> split between web and desktop, and the seam between them are real and tested, and so are the schema a
> component's content is held in - [the content model](#the-content-model) below - and the rules deciding
> its metadata - [metadata](#metadata). Nothing authors either, stores it or publishes it yet.
```

keeping the sentences after it about the scaffolding `Component` and the proposed system.

Replace the `packages/domain` row's Holds cell with:

```markdown
The content model - the stored shape of a component's content, its canonical form and its migration chain - the metadata rules - field, schema and component type definitions, resolution, validation and carrying forward - the theme model, and their rules. Pure TypeScript + zod - no React, no Electron, no `fs`
```

Add a section after "The content model" section and before "One renderer, two deliveries":

```markdown
## Metadata

`packages/domain/src/metadata/` holds the rules that decide which fields apply to a component, what
makes a value valid, and what a version records about the definitions it was written against, designed
in [`design/metadata.md`](design/metadata.md). They are pure functions over definition payloads a
caller hands in. Nothing stores a definition or a value, no route calls them, and no panel shows them.

| File                  | Holds                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| `lexical.ts`          | The forms a value takes: a decimal as a canonical string, a date, a time, a date and time with its offset     |
| `definition.ts`       | The definition schema version every field, schema and component type records                                  |
| `field.ts`            | Seven closed data types, and the field definition. No `pattern` yet                                           |
| `schema.ts`           | The metadata schema definition, and `checkSchema`, which checks each default against its field                |
| `component-type.ts`   | The component type definition, whose assignments name a schema and the fields they require                    |
| `migrate.ts`          | The migration chain per definition kind, applied on read, and `readDefinition`'s report                       |
| `check-value.ts`      | `checkValue(field, value)`: the field's own rules, and nothing else                                           |
| `resolve.ts`          | `resolveComponentFields`, and the error a default it cannot use throws - disagreeing, or refused by its field |
| `check-assignment.ts` | `checkAssignment`: a stray `requires`, and a default that disagrees with one already assigned                 |
| `validate.ts`         | `validate(effective, values)`: every failure, each naming the schemas behind a schema's rule                  |
| `users.ts`            | `checkUserValues` over a lookup the service supplies, and `principalIdsIn` to load it in one query            |
| `carry.ts`            | `carryForward`: what the next version holds, and `notCarried`                                                 |
| `record.ts`           | `definitionsFor`, and the canonical form of values and `notCarried` in the version digest                     |
| `fixtures/v1/`        | Stored definitions at definition schema version 1, never deleted                                              |

**Four properties, because each is a decision rather than an implementation detail.**

**A value is valid or not by its field alone.** `checkValue` takes the field and the value. The two
rules a schema imposes - required and fixed - are `validate`'s, and name every schema that imposed
them; checking that a user value names somebody needs the directory, so it is `checkUserValues`, apart
from `validate`, which runs at publish with no directory to hand.

**A number is the string entered.** It is valid only in canonical form - no leading zeros, no trailing
fractional zeros - and `canonicaliseDecimal` is how a caller gets there. Comparison is exact, so a bound
of `9007199254740993` means that number and not its nearest float.

**Carrying forward never changes a value that is present.** No member and a clear are different: only
a field with no member takes a default, so a clear survives, and a present value on a fixed field that
differs from its default stays for `validate` to name rather than being replaced.

**Definitions are read the way content is.** Every payload records its definition schema version and is
migrated on read, never on write, through the chain `packages/domain/src/stored/` now provides to
content and definitions alike, beside the canonical rules both serialise with.

`pattern` does not exist yet: metadata.md's open question on bounding its backtracking is unanswered,
and the field definition refuses one.
```

Add a sentence to the end of the content model section's "Hashing is deliberately not here" paragraph:

```markdown
The canonical rules and the migration chain themselves live in `packages/domain/src/stored/`, shared
with the metadata definitions; `canonicalise` names `marks` as the one member whose array is a set.
```

- [ ] **Step 6: Leave the features alone, and say why**

`docs/features.md` and `README.md` stay as they are: nothing a person can see or do has changed. A
reviewer asking why the Features table did not move should find this step.

- [ ] **Step 7: Mark the plan built**

In `docs/plans/README.md`, in the Metadata section, change this plan's status from `Planned` to
`Built (PR #n)`, and add a paragraph after the table naming what it leaves, from "What this plan
deliberately leaves undone" below.

- [ ] **Step 8: Bump the version and write the changelog**

A functional enhancement: Minor + 1, Build 0, from whatever `version.json` says on `main` when this
lands. At the time of writing that is `0.18.3`, so `0.19.0`. Set it in `version.json`, the root
`package.json` and `apps/desktop/package.json`. `apps/desktop/src/version.test.ts` fails if they
disagree, or if the changelog's top entry does not match.

Add to the top of `CHANGELOG.md`:

```markdown
## 0.19.0 - YYYY-MM-DD (PR #n)

### Added

- **The rules for a component's metadata**, in `packages/domain/src/metadata/`, built from
  [the metadata design](docs/design/metadata.md). Fields, metadata schemas and component types are
  definitions that record the version of their own format and are read forward from it, with a stored
  example of each kept for good.
- **Validation that reports every problem at once**, each naming the field, the rule and, where a schema
  made the rule, every schema that did. A number is held as the decimal text entered, so a value such
  as 0.1 is never changed by rounding, and a date and time must say its offset from UTC.
- **Carrying values into the next version without changing any value that is there**: a cleared value
  stays cleared, a field with no value takes its default, and a value whose field no longer applies is
  recorded with the version rather than lost.
- **A check that every person named in a value belongs to the organisation**, which still accepts a
  person who has since left.
- Nothing in the application shows or stores metadata yet; these are the rules the editor, the service
  and publishing will share.

### Changed

- The content model's canonical form and its migration chain are now shared with metadata. Content
  serialises and migrates exactly as before.
```

- [ ] **Step 9: Format, run everything, and open the pull request**

```bash
pnpm exec prettier --write docs/architecture.md docs/plans/README.md CHANGELOG.md packages/trace/src/trace.test.ts
pnpm format && pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm trace gate
git add -A
git commit -m "Release 0.19.0: the metadata rules"
git push -u origin <branch>
gh pr create --base main --title "Build the metadata rules"
```

---

## What this plan deliberately leaves undone

Named here so the next plan starts from a list rather than from a reading of the diff.

- **`pattern`.** metadata.md's open question: a linear-time engine that behaves identically in the
  renderer, the service and the publisher, or a checked subset. The field definition refuses one until
  it is answered, and adding it is a definition schema version with a migration and a fixture.
- **Storing anything.** The `values` and `not_carried` columns, `version_definition`, and the version
  digest over the whole version are storage-and-versioning.md's plan. It composes `canonicaliseValues`,
  `canonicaliseNotCarried` and `definitionsFor` with content's `canonicalise` into the serialisation
  ADR-0024 says the package owes; this plan does not guess that record's shape.
- **The service's refusals** - `metadata.fixed`, `metadata.type`, `metadata.user` on an iteration or a
  cut, inside service-foundations' error shape with the artifact added (MET-022's fourth member) - and
  the lookup `checkUserValues` is handed. component-editor.md's plan.
- **The metadata panel** and re-resolution when definitions change mid-session. component-editor.md.
- **Refusing an assignment** (MET-008) and **refusing a schema version** that conflicts anywhere
  (MET-035). `checkAssignment` finds both kinds of conflict; nothing acts on what it finds until the
  definitions-management design exists.
- **Refusing a field version that would make a schema's default invalid** (MET-037). Resolution throws
  on such a default meanwhile, so it is never applied; refusing the field version when it is saved needs
  where-used and belongs to the definitions-management design. No test in this plan cites MET-037.
- **Whether `text` needs a language** (metadata.md's second open question).
