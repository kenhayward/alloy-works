# Traceability 2: the test edge

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two edges stage 1 left open - a requirement to the test that names it, and that
test to whether it passed - and move the corpus invariants out of test files into a module anyone can
run.

**Architecture:** A citation scanner, pure like every other parser, finds the requirement identifiers
that tests name in their `describe`/`it` titles and in the `rule:` field of an error payload.
Citations are a function of the source, so they join the committed `trace.json`. Test **results** are
a function of a run, so they never do: every `vitest.config.ts` gains the built-in JSON reporter
alongside its pinned default one, and `pnpm trace verify` reads those files at query time. A new
`check.ts` holds the corpus invariants as data, so `pnpm trace check` answers what only a Vitest run
could answer before.

**Tech Stack:** TypeScript, zod 4, Vitest 5, tsx. No new dependency.

**Spec:** [`../superpowers/specs/2026-09-13-requirements-traceability-design.md`](../superpowers/specs/2026-09-13-requirements-traceability-design.md)

This is stage 2 of four. Stage 1 shipped in PR #61 and is on `main`.

## Three things settled before this plan was written

Each was verified by experiment, not reasoning, and each changes what the design document said.

**1. The design document is wrong about `results`, in the same way it was wrong about `sha`.** Its
example model at section 8 carries a `results` array. A pass-or-fail record is a function of a test
run, not of the documents, so committing it would churn on every run and make the drift check
impossible - exactly the defect already corrected for `sha` and `generatedAt` in stage 1. Task 5
corrects the document. **Citations are committed; results are not.**

**2. The built-in JSON reporter replaces the custom Vitest reporter the design proposed.** Vitest
5.0.0's reporter surface offers `onCollected`, `onFinished` and `onTaskUpdate` - no per-test hook - so
a custom reporter would have to walk `onFinished`'s task tree, which is internals that move between
versions. The built-in `json` reporter emits a documented shape with `fullName`, `title`,
`ancestorTitles` and `status` per test. Verified working from a config rather than the command line:

```ts
reporters: ['default', 'json'],
outputFile: { json: '../../.trace-results/trace.json' },
```

That keeps `'default'` pinned first, which is the whole point of the repository's reporter rule, and
writes the results file as a side effect of an ordinary `pnpm test`.

**3. `ZZZ` must be reserved, or the new check fails on this package's own fixtures.** Every parser
test in `packages/trace` uses invented `ZZZ-` identifiers - eleven of them. The rule "every identifier
a test cites must exist" would refuse all eleven. Excluding the whole package from the scan would
blind the scan to the package's real tests, so instead `ZZZ` becomes a permanently reserved area code
that may never be allocated, the scanner ignores it, and a test enforces that it is never allocated.
That keeps the scan honest everywhere and makes the fixture convention explicit rather than tacit.

## Global Constraints

- **Test first, always.** Write the failing test, run it, watch it fail, then the minimal code to
  pass. Report the verbatim red output.
- **A passing run has no errors or warnings.** `consoleGate` throws from `console.error` and
  `console.warn`.
- **`'default'` stays the first reporter in every `vitest.config.ts`.** Adding `'json'` after it is
  the only change permitted to that array. Left implicit, a run swallows console output on Windows
  while the identical run on Linux prints it.
- **Parsers take text, never a path.** `compile.ts` remains the only module that reads files.
- **Citations are committed in `trace.json`; results are never committed.**
- **`ZZZ` is a reserved area code.** Fixtures use it; the corpus never allocates it.
- **No em or en dashes in the changelog.** Plain hyphen `-`.
- **Identifier shape, verbatim:** `^[A-Z]{3}-\d{3}$`, matched with word boundaries so that
  `ADR-0013` in a test title is not read as `ADR-001`.
- **Corpus facts at the commit this plan was written against:** 1,303 requirements, 112
  non-requirements, 131 questions, 21 areas, 175 claimed identifiers, 8 designs. Thirteen real
  requirement identifiers are cited by tests: `IAM-004`, `IAM-018`, `IAM-043`, `IAM-054`, `REL-002`,
  `STY-009`, `STY-027`, `STY-035`, `STY-037`, `STY-038`, `STY-050`, `STY-051`, `STY-052`. Only some
  of those are in a `describe`/`it` title or a `rule:` field; the rest are in comments and **must not
  count**.
- **`IAM-018` is cited by a test and claimed by no design.** This is a real gap, found in stage 1. It
  must be reported by `pnpm trace check`, not worked around.
- **Version bump for the whole plan:** Minor, `0.11.0` to `0.12.0`. One bump, one changelog entry, in
  Task 6.
- **Strict TypeScript:** `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`. `.js` extensions on imports.
- **Every commit message needs a BLANK line before its `Co-Authored-By:` trailer**, or git folds it
  into the subject. Verify with `git log -1 --format='%s'`.

---

## File structure

| File                                    | Responsibility                                                     |
| --------------------------------------- | ------------------------------------------------------------------ |
| `packages/trace/src/model.ts`           | Gains `Citation`, `RESERVED_AREA`, and `citations` on `TraceModel` |
| `packages/trace/src/parse/citations.ts` | Test file text to the identifiers its titles and rules name        |
| `packages/trace/src/check.ts`           | The corpus invariants, as data: `problems(model)`                  |
| `packages/trace/src/results.ts`         | A Vitest JSON report to per-identifier outcomes                    |
| `packages/trace/src/state.ts`           | Gains `Covered` and `Verified`                                     |
| `packages/trace/src/compile.ts`         | Also walks the repository's test files                             |
| `packages/trace/src/format.ts`          | Renders citations, problems and the wider stats table              |
| `packages/trace/src/cli.ts`             | Gains `check` and `verify`                                         |
| every `vitest.config.ts`                | `'json'` after `'default'`, writing to `.trace-results/`           |

---

## Task 1: Reserve ZZZ, and scan a test file for citations

**Files:**

- Modify: `packages/trace/src/model.ts`
- Create: `packages/trace/src/parse/citations.ts`
- Test: `packages/trace/src/parse/citations.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: `RESERVED_AREA`; the schema and type `Citation`;
  `parseCitations(file: string, text: string): Citation[]`.

- [ ] **Step 1: Write the failing test**

`packages/trace/src/parse/citations.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { parseCitations } from './citations.js';

const file = 'apps/invented/src/widget.test.ts';

describe('scanning a test file for citations', () => {
  it('reads an identifier out of an it title', () => {
    const text = `it('refuses a widget nobody asked for (ABC-043)', () => {});`;

    expect(parseCitations(file, text)).toEqual([{ id: 'ABC-043', file, line: 1, kind: 'title' }]);
  });

  it('reads an identifier out of a describe title', () => {
    const text = `describe('what a widget may do (ABC-004)', () => {});`;

    expect(parseCitations(file, text)).toEqual([{ id: 'ABC-004', file, line: 1, kind: 'title' }]);
  });

  it('reads an identifier out of a rule field, which is how the product cites itself', () => {
    const text = `expect(response.json()).toMatchObject({ code: 'closed', rule: 'ABC-043' });`;

    expect(parseCitations(file, text)).toEqual([{ id: 'ABC-043', file, line: 1, kind: 'rule' }]);
  });

  // Mentioning a requirement is not claiming to verify it. This is the whole reason the strict count
  // of cited identifiers in this repository is smaller than a naive grep suggests.
  it('ignores an identifier in a comment', () => {
    const text = [
      '// The case this exists for is the one a filter forgets (ABC-004).',
      "it('x', () => {});",
    ].join('\n');

    expect(parseCitations(file, text)).toEqual([]);
  });

  it('ignores an identifier in ordinary code that is not a title or a rule', () => {
    const text = `const requirement = 'ABC-004';`;

    expect(parseCitations(file, text)).toEqual([]);
  });

  it('reads every identifier a single title names', () => {
    const text = `it('holds for both (ABC-004) and (ABC-005)', () => {});`;

    expect(parseCitations(file, text).map((citation) => citation.id)).toEqual([
      'ABC-004',
      'ABC-005',
    ]);
  });

  it('reports the line the citation is on, not the line the file starts at', () => {
    const text = ['', '', `it('a widget must spin (ABC-007)', () => {});`].join('\n');

    expect(parseCitations(file, text)[0]?.line).toBe(3);
  });

  it('finds an identifier in a title that prettier wrapped onto the next line', () => {
    const text = [
      'it(',
      `  'a widget must do a great many things, enough that the title does not fit (ABC-009)',`,
      '  () => {},',
      ');',
    ].join('\n');

    expect(parseCitations(file, text).map((citation) => citation.id)).toEqual(['ABC-009']);
  });

  // ZZZ is reserved for fixtures. This package's own parser tests are full of ZZZ identifiers, and
  // the rule that every cited identifier must exist would otherwise refuse all of them.
  it('ignores the reserved fixture area entirely', () => {
    const text = `it('a fixture widget must exist (ZZZ-001)', () => {});`;

    expect(parseCitations(file, text)).toEqual([]);
  });

  // A decision record is not a requirement, and `\b` is what stops ADR-0013 reading as ADR-001.
  it('does not mistake a four-digit decision record for a requirement', () => {
    const text = `it('treats the data as data (ADR-0013)', () => {});`;

    expect(parseCitations(file, text)).toEqual([]);
  });

  it('deduplicates a title that names the same identifier twice', () => {
    const text = `it('ABC-011 and again ABC-011', () => {});`;

    expect(parseCitations(file, text)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @alloy-works/trace test citations
```

Expected: FAIL, cannot resolve `./citations.js`.

- [ ] **Step 3: Add the reserved area and the Citation schema to `model.ts`**

Add near the other identifier constants:

```ts
/**
 * The area code fixtures use, permanently reserved and never allocated to a real area.
 *
 * Without it the rule "every identifier a test cites must exist" would refuse this package's own
 * parser fixtures, and excluding the package from the scan would blind the scan to its real tests.
 * Reserving one code keeps the scan honest everywhere and makes the fixture convention explicit.
 */
export const RESERVED_AREA = 'ZZZ';
```

And, after `DesignClaim`:

```ts
/** Where a test names a requirement: in its own title, or in the `rule:` field of a refusal. */
export const Citation = z.object({
  id: z.string().regex(REQUIREMENT_ID),
  file: z.string().min(1),
  line: z.number().int().positive(),
  kind: z.enum(['title', 'rule']),
});
export type Citation = z.infer<typeof Citation>;
```

Do **not** add `citations` to `TraceModel` yet - that is Task 2, and adding it here would break the
committed `trace.json` before the generator can write it.

- [ ] **Step 4: Write the scanner**

`packages/trace/src/parse/citations.ts`:

```ts
import { Citation, REQUIREMENT_ID, RESERVED_AREA, validate } from '../model.js';

/**
 * A test title, however the formatter wrapped it. Matches `describe(`, `it(`, `test(` and their
 * modifiers, then the first string literal, in any of the three quote styles. The lazy body with an
 * escape alternative is what lets a title span lines without swallowing the rest of the file.
 */
const TITLE = /\b(?:describe|it|test)(?:\.\w+)*\s*\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;

/** `rule: 'IAM-043'` in a refusal payload - the product citing the requirement it is enforcing. */
const RULE = /\brule:\s*(['"`])([A-Z]{3}-\d{3})\1/g;

/** Word-bounded so that `ADR-0013` is not read as `ADR-001`. */
const IDENTIFIER = /\b[A-Z]{3}-\d{3}\b/g;

const lineOf = (text: string, index: number): number => text.slice(0, index).split(/\r?\n/).length;

/**
 * A test file's text to the requirements it names. Takes text rather than a path, so its tests are
 * template literals.
 *
 * Only a title or a `rule:` field counts. An identifier in a comment, or in ordinary code, is a
 * mention - and mentioning a requirement is not claiming to verify it. That distinction is why the
 * honest count of cited requirements in this repository is smaller than a grep suggests.
 */
export function parseCitations(file: string, text: string): Citation[] {
  const found = new Map<string, Citation>();

  // One citation per identifier per kind per file. Two tests in the same file naming the same
  // requirement in their titles are one fact about that file, and the first one's line is the useful
  // one to report. A citation from a different file is a different fact and gets its own row,
  // because parseCitations is called once per file.
  const add = (id: string, index: number, kind: 'title' | 'rule'): void => {
    if (id.slice(0, 3) === RESERVED_AREA) return;
    if (!REQUIREMENT_ID.test(id)) return;
    const key = `${id}:${kind}`;
    if (found.has(key)) return;
    const line = lineOf(text, index);
    found.set(key, validate(Citation, { id, file, line, kind }, `${file}:${line}`));
  };

  for (const match of text.matchAll(TITLE)) {
    const title = match[2] ?? '';
    for (const identifier of title.matchAll(IDENTIFIER)) {
      add(identifier[0], match.index, 'title');
    }
  }

  for (const match of text.matchAll(RULE)) {
    add(match[2]!, match.index, 'rule');
  }

  return [...found.values()].sort((left, right) =>
    left.id === right.id ? left.kind.localeCompare(right.kind) : left.id.localeCompare(right.id),
  );
}
```

- [ ] **Step 5: Run the test and watch it pass**

```bash
pnpm --filter @alloy-works/trace test citations
```

Expected: PASS, 11 tests.

- [ ] **Step 6: Pin that ZZZ is never allocated**

Add to `packages/trace/src/requirements.test.ts`, inside `describe('the requirements index')`:

```ts
// Fixtures across this package use ZZZ identifiers, and the citation scan ignores that area on
// purpose. Allocating it to a real area would silently make every fixture look like a real
// citation, and every real ZZZ requirement invisible to the scan.
it('never allocates the area code reserved for fixtures', () => {
  expect(indexRows.map((row) => row.area)).not.toContain(RESERVED_AREA);
});
```

Import `RESERVED_AREA` from `./model.js` in that file.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
pnpm --filter @alloy-works/trace typecheck
pnpm lint
pnpm exec prettier --write packages/trace
git add packages/trace
git commit -m "Read the requirements a test names, and reserve the fixture area"
```

---

## Task 2: Compile citations, and refuse one that names nothing

**Files:**

- Modify: `packages/trace/src/model.ts` (add `citations` to `TraceModel`)
- Modify: `packages/trace/src/compile.ts`
- Modify: `packages/trace/trace.json` (regenerated)
- Test: `packages/trace/src/trace.test.ts`

**Interfaces:**

- Consumes: `parseCitations`.
- Produces: `TraceModel.citations`; `testFilesIn(repoRoot: string): string[]` exported from
  `compile.ts` so a test can assert what it walks.

- [ ] **Step 1: Write the failing test**

Add to `packages/trace/src/trace.test.ts`:

```ts
describe('the citations in the committed model', () => {
  const model = TraceModel.parse(
    JSON.parse(readFileSync(new URL('../trace.json', import.meta.url), 'utf8')),
  );

  it('found the identifiers this repository already cites in its test titles', () => {
    const cited = new Set(model.citations.map((citation) => citation.id));

    // Thirteen requirement identifiers appear anywhere in a test file; these are the ones that
    // appear in a title or a rule, which is the only kind that counts as coverage.
    expect(cited.has('IAM-043')).toBe(true);
    expect(cited.has('IAM-054')).toBe(true);
    expect(cited.has('IAM-018')).toBe(true);
    expect(cited.has('STY-050')).toBe(true);
    expect(cited.size).toBeGreaterThan(5);
  });

  it('cites no identifier the corpus does not hold', () => {
    const known = new Set(model.requirements.map((requirement) => requirement.id));
    const unknown = model.citations.map((citation) => citation.id).filter((id) => !known.has(id));

    expect(unknown).toEqual([]);
  });

  it('never cites the reserved fixture area', () => {
    const reserved = model.citations.filter(
      (citation) => citation.id.slice(0, 3) === RESERVED_AREA,
    );

    expect(reserved).toEqual([]);
  });

  it('records a path a person can open, relative to the repository root', () => {
    for (const citation of model.citations) {
      expect(citation.file, `${citation.id} path`).toMatch(/^(apps|packages|tests)\//);
      expect(citation.file).not.toContain('\\');
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @alloy-works/trace test trace
```

Expected: FAIL - `TraceModel` has no `citations`, so `.parse` rejects the committed file or the
property is missing.

- [ ] **Step 3: Add `citations` to the model**

In `packages/trace/src/model.ts`, add to `TraceModel`:

```ts
  citations: z.array(Citation),
```

Keep the comment above `TraceModel` and extend it:

```ts
/**
 * Deliberately carries no commit hash, no timestamp, and no test results. The commit that holds the
 * file is its provenance; a hash or a timestamp would change on every commit, and a result changes
 * on every RUN - all three would make the drift check in `trace.test.ts` impossible to pass.
 *
 * Citations are here because they are a function of the source, exactly like a requirement or a
 * design claim. Results are read at query time from a Vitest JSON report instead.
 */
```

- [ ] **Step 4: Walk the repository's test files in `compile.ts`**

```ts
const TEST_FILE = /\.test\.ts$/;
const SKIP = new Set(['node_modules', 'dist', '.turbo', 'coverage', '.superpowers']);

/**
 * Every test file in the workspaces, as repository-relative POSIX paths, sorted - so that the
 * committed model is a function of the files and not of directory order, on any platform.
 */
export function testFilesIn(repoRoot: string): string[] {
  const found: string[] = [];

  const walk = (directory: string, relative: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const nextRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;
      const nextAbsolute = join(directory, entry.name);
      if (entry.isDirectory()) walk(nextAbsolute, nextRelative);
      else if (TEST_FILE.test(entry.name)) found.push(nextRelative);
    }
  };

  for (const root of ['apps', 'packages', 'tests']) {
    const absolute = join(repoRoot, root);
    if (existsSync(absolute)) walk(absolute, root);
  }

  return found.sort();
}
```

Add `existsSync` and `readdirSync` to the `node:fs` import, then in `compile`:

```ts
    citations: testFilesIn(repoRoot).flatMap((file) =>
      parseCitations(file, read(repoRoot, ...file.split('/'))),
    ),
```

- [ ] **Step 5: Regenerate and run**

```bash
pnpm --filter @alloy-works/trace generate
pnpm --filter @alloy-works/trace test
```

Expected: PASS. The committed `trace.json` grows a `citations` array.

**If `cites no identifier the corpus does not hold` fails**, a test in this repository names a
requirement that does not exist - which is precisely the renumbering this check is for. Report it;
do not delete the citation or the check.

- [ ] **Step 6: Confirm determinism across platforms**

```bash
pnpm --filter @alloy-works/trace generate
git diff --stat packages/trace/trace.json
pnpm --filter @alloy-works/trace generate
git diff --stat packages/trace/trace.json
```

Expected: empty both times. The sort in `testFilesIn` is what guarantees it; a `readdirSync` order
that differs between Windows and Linux would otherwise churn the file in CI.

- [ ] **Step 7: Commit**

```bash
pnpm exec prettier --write packages/trace
git add packages/trace
git commit -m "Put the citations in the index, and refuse one that names nothing"
```

---

## Task 3: The corpus invariants, as data rather than as assertions

**Files:**

- Create: `packages/trace/src/check.ts`
- Test: `packages/trace/src/check.test.ts`
- Modify: `packages/trace/src/requirements.test.ts`, `packages/trace/src/design.test.ts`

**Interfaces:**

- Produces: `interface Problem { kind: ProblemKind; id: string; detail: string }`;
  `type ProblemKind`; `problems(model: TraceModel): Problem[]`.

This is the finding a whole-branch review raised against stage 1: every corpus invariant lived inside
a test file, invisible to `compile.ts`, to `trace.json`, and to anybody not running Vitest -
including an auditor. `state.ts` silently depends on one of them (that a requirement has at most one
owning design). The assertions move here; they do not multiply.

- [ ] **Step 1: Write the failing test**

`packages/trace/src/check.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { problems } from './check.js';
import type { Requirement, TraceModel } from './model.js';

const requirement = (id: string, status = 'Specified'): Requirement => ({
  id,
  area: id.slice(0, 3),
  statement: 'A widget must exist',
  tranche: 'T1',
  status,
  document: `${id.slice(0, 3)}-invented-area.md`,
  line: 1,
});

const model = (over: Partial<TraceModel>): TraceModel => ({
  requirements: [requirement('ZZZ-001'), requirement('ZZZ-002')],
  nonRequirements: [],
  questions: [],
  designs: [],
  citations: [],
  ...over,
});

describe('the problems in a corpus', () => {
  it('finds none in a corpus that is sound', () => {
    expect(problems(model({}))).toEqual([]);
  });

  it('reports a requirement two designs both claim', () => {
    const found = problems(
      model({
        designs: [
          { document: 'one.md', owns: [{ id: 'ZZZ-001', howItIsMet: 'a' }] },
          { document: 'two.md', owns: [{ id: 'ZZZ-001', howItIsMet: 'b' }] },
        ],
      }),
    );

    expect(found.map((problem) => problem.kind)).toEqual(['claimed-twice']);
    expect(found[0]?.detail).toContain('one.md');
    expect(found[0]?.detail).toContain('two.md');
  });

  it('reports a design claiming a requirement that does not exist', () => {
    const found = problems(
      model({ designs: [{ document: 'one.md', owns: [{ id: 'ZZZ-404', howItIsMet: 'a' }] }] }),
    );

    expect(found.map((problem) => problem.kind)).toEqual(['claims-unknown']);
  });

  it('reports a hole in an area, which is how a deletion disguises itself as an edit', () => {
    const found = problems({
      ...model({}),
      requirements: [requirement('ZZZ-001'), requirement('ZZZ-003')],
    });

    expect(found.map((problem) => problem.kind)).toEqual(['not-contiguous']);
  });

  it('reports the same identifier issued twice', () => {
    const found = problems({
      ...model({}),
      requirements: [requirement('ZZZ-001'), requirement('ZZZ-001')],
    });

    expect(found.map((problem) => problem.kind)).toContain('issued-twice');
  });

  it('reports a requirement whose area disagrees with the document holding it', () => {
    const stray = { ...requirement('ZZZ-002'), document: 'AAA-invented-area.md' };

    expect(
      problems({ ...model({}), requirements: [requirement('ZZZ-001'), stray] }).map((p) => p.kind),
    ).toContain('wrong-document');
  });

  it('reports a superseding status pointing at nothing', () => {
    const found = problems({
      ...model({}),
      requirements: [requirement('ZZZ-001', 'Superseded by ZZZ-404'), requirement('ZZZ-002')],
    });

    expect(found.map((problem) => problem.kind)).toEqual(['supersedes-unknown']);
  });

  it('reports a citation naming a requirement that does not exist', () => {
    const found = problems(
      model({ citations: [{ id: 'ZZZ-404', file: 'a.test.ts', line: 1, kind: 'title' }] }),
    );

    expect(found.map((problem) => problem.kind)).toEqual(['cites-unknown']);
  });

  // This is IAM-018 in the real corpus: a test names a requirement no design answers. The tool must
  // report it rather than smooth it over, because it is the exact gap this work exists to expose.
  it('reports a requirement a test cites and no design claims', () => {
    const found = problems(
      model({ citations: [{ id: 'ZZZ-001', file: 'a.test.ts', line: 1, kind: 'title' }] }),
    );

    expect(found.map((problem) => problem.kind)).toEqual(['cited-undesigned']);
    expect(found[0]?.id).toBe('ZZZ-001');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @alloy-works/trace test check
```

Expected: FAIL, cannot resolve `./check.js`.

- [ ] **Step 3: Write `check.ts`**

```ts
import { SUPERSEDED_BY, type TraceModel } from './model.js';

export type ProblemKind =
  | 'issued-twice'
  | 'wrong-document'
  | 'not-contiguous'
  | 'supersedes-unknown'
  | 'claims-unknown'
  | 'claimed-twice'
  | 'cites-unknown'
  | 'cited-undesigned';

export interface Problem {
  readonly kind: ProblemKind;
  readonly id: string;
  readonly detail: string;
}

/**
 * Every property of the corpus that no single row can establish, computed rather than asserted.
 *
 * These lived as assertions inside two test files, which meant the only way to learn whether the
 * corpus was sound was to run Vitest. `state.ts` depends on one of them - that a requirement has at
 * most one owning design - without being able to see it. Here they are data, the tests assert this
 * list is empty, and `pnpm trace check` gives a person the same answer.
 */
export function problems(model: TraceModel): Problem[] {
  const found: Problem[] = [];
  const known = new Set(model.requirements.map((requirement) => requirement.id));

  const seen = new Set<string>();
  for (const requirement of model.requirements) {
    if (seen.has(requirement.id)) {
      found.push({
        kind: 'issued-twice',
        id: requirement.id,
        detail: `allocated more than once, in ${requirement.document}`,
      });
    }
    seen.add(requirement.id);

    if (requirement.document.slice(0, 3) !== requirement.id.slice(0, 3)) {
      found.push({
        kind: 'wrong-document',
        id: requirement.id,
        detail: `sits in ${requirement.document}, which belongs to another area`,
      });
    }

    const target = SUPERSEDED_BY.exec(requirement.status)?.[1];
    if (target !== undefined && !known.has(target)) {
      found.push({
        kind: 'supersedes-unknown',
        id: requirement.id,
        detail: `is superseded by ${target}, which does not exist`,
      });
    }
  }

  const byArea = new Map<string, number[]>();
  for (const requirement of model.requirements) {
    const area = requirement.id.slice(0, 3);
    byArea.set(area, [...(byArea.get(area) ?? []), Number.parseInt(requirement.id.slice(4), 10)]);
  }
  for (const [area, numbers] of [...byArea].sort()) {
    const highest = Math.max(...numbers);
    const missing = Array.from({ length: highest }, (_, index) => index + 1).filter(
      (number) => !numbers.includes(number),
    );
    if (missing.length > 0) {
      found.push({
        kind: 'not-contiguous',
        id: area,
        detail: `is missing ${missing.map((number) => String(number).padStart(3, '0')).join(', ')} below ${highest}. A withdrawn requirement keeps its row; a deleted one leaves this hole`,
      });
    }
  }

  const claimedBy = new Map<string, string[]>();
  for (const design of model.designs) {
    for (const claim of design.owns) {
      claimedBy.set(claim.id, [...(claimedBy.get(claim.id) ?? []), design.document]);
      if (!known.has(claim.id)) {
        found.push({
          kind: 'claims-unknown',
          id: claim.id,
          detail: `is claimed by ${design.document} but does not exist`,
        });
      }
    }
  }
  for (const [id, documents] of [...claimedBy].sort()) {
    if (documents.length > 1) {
      found.push({
        kind: 'claimed-twice',
        id,
        detail: `is claimed by ${documents.join(' and ')}. Exactly one design owns a requirement`,
      });
    }
  }

  for (const citation of model.citations) {
    if (!known.has(citation.id)) {
      found.push({
        kind: 'cites-unknown',
        id: citation.id,
        detail: `is named by ${citation.file}:${citation.line} but does not exist`,
      });
      continue;
    }
    if (!claimedBy.has(citation.id)) {
      found.push({
        kind: 'cited-undesigned',
        id: citation.id,
        detail: `is named by ${citation.file}:${citation.line} and claimed by no design`,
      });
    }
  }

  return found;
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
pnpm --filter @alloy-works/trace test check
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Delegate the moved assertions**

In `packages/trace/src/requirements.test.ts`, replace the bodies of `never issues the same identifier
twice`, `keeps every requirement under the area code of the document holding it`, `numbers each area
from 001 with no gap and no repeat` and `points every superseding status at a requirement that
exists` with an assertion against `problems`, keeping each test's name:

```ts
it('never issues the same identifier twice', () => {
  expect(problems(model).filter((problem) => problem.kind === 'issued-twice')).toEqual([]);
});
```

Do the same in `packages/trace/src/design.test.ts` for `claims only requirements that exist`
(`claims-unknown`) and `gives every requirement at most one owning design` (`claimed-twice`).

**Leave every other test in both files alone** - the index checks, the ownership map and the design
README checks read files from disk and are not model properties.

- [ ] **Step 6: Confirm the real corpus has exactly the problems we expect, and no others**

```bash
pnpm --filter @alloy-works/trace test
```

Then, once **Task 5** adds the command, `pnpm trace check` must report `cited-undesigned` for `IAM-018` and
for any of the six superseded-but-claimed requirements found in stage 1. **Record what it actually
reports in your report.** If it reports a kind this plan does not predict, that is a real finding
about the corpus and I want to know rather than have it suppressed.

- [ ] **Step 7: Commit**

```bash
pnpm --filter @alloy-works/trace typecheck
pnpm exec prettier --write packages/trace
git add packages/trace
git commit -m "Make the corpus invariants data, not assertions locked in a test file"
```

---

## Task 4: Results, and the two new rungs

**Files:**

- Create: `packages/trace/src/results.ts`
- Test: `packages/trace/src/results.test.ts`
- Modify: `packages/trace/src/state.ts`, `packages/trace/src/state.test.ts`
- Modify: `docs/superpowers/specs/2026-09-13-requirements-traceability-design.md`

**Interfaces:**

- Produces: `type Outcome = 'passed' | 'failed' | 'skipped'`;
  `interface Verification { id: string; outcome: Outcome; tests: string[] }`;
  `parseResults(reports: unknown[]): Map<string, Verification>`;
  `traceOf(id, model, verifications?)` and `allTraces(model, verifications?)` gaining an optional
  second argument.

- [ ] **Step 1: Correct the design document first, and commit that alone**

Section 8's example model carries a `results` array. Remove it, and add after the code block:

```markdown
The model carries no test results either, for the same reason it carries no commit hash: a result is
a function of a run, not of the documents, so committing one would churn on every run and make the
drift check impossible. Citations are committed because they are a function of the source. Results
are read at query time from the JSON report every suite already writes.
```

Also correct the stage 2 row of the table in section 13 and the `test -> result` row in section 5:
the mechanism is the **built-in JSON reporter**, declared in each `vitest.config.ts` alongside the
pinned default one, not a custom reporter. Vitest 5 offers no per-test reporter hook, so a custom one
would have to walk `onFinished`'s task tree - internals that move between versions.

```bash
git add docs/superpowers/specs/2026-09-13-requirements-traceability-design.md
git commit -m "Keep results out of the model, and use the reporter Vitest already has"
```

- [ ] **Step 2: Write the failing results test**

`packages/trace/src/results.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { parseResults } from './results.js';

const report = (assertions: { fullName: string; status: string }[]): unknown => ({
  numTotalTests: assertions.length,
  testResults: [{ name: 'x.test.ts', assertionResults: assertions }],
});

describe('reading a Vitest JSON report', () => {
  it('verifies a requirement whose test passed', () => {
    const found = parseResults([report([{ fullName: 'refuses it (ABC-043)', status: 'passed' }])]);

    expect(found.get('ABC-043')?.outcome).toBe('passed');
    expect(found.get('ABC-043')?.tests).toEqual(['refuses it (ABC-043)']);
  });

  it('does not verify a requirement whose test failed', () => {
    const found = parseResults([report([{ fullName: 'refuses it (ABC-043)', status: 'failed' }])]);

    expect(found.get('ABC-043')?.outcome).toBe('failed');
  });

  // One passing test does not excuse a failing one. A requirement is verified when everything
  // claiming to verify it passed, which is the only reading that makes the word mean anything.
  it('refuses to verify where one test naming it passed and another failed', () => {
    const found = parseResults([
      report([
        { fullName: 'one (ABC-043)', status: 'passed' },
        { fullName: 'two (ABC-043)', status: 'failed' },
      ]),
    ]);

    expect(found.get('ABC-043')?.outcome).toBe('failed');
    expect(found.get('ABC-043')?.tests).toHaveLength(2);
  });

  it('treats a skipped test as not verifying anything', () => {
    const found = parseResults([report([{ fullName: 'one (ABC-043)', status: 'skipped' }])]);

    expect(found.get('ABC-043')?.outcome).toBe('skipped');
  });

  it('reads across several reports, because each package writes its own', () => {
    const found = parseResults([
      report([{ fullName: 'one (ABC-001)', status: 'passed' }]),
      report([{ fullName: 'two (ABC-002)', status: 'passed' }]),
    ]);

    expect([...found.keys()].sort()).toEqual(['ABC-001', 'ABC-002']);
  });

  it('ignores the reserved fixture area', () => {
    expect(
      parseResults([report([{ fullName: 'a fixture (ZZZ-001)', status: 'passed' }])]).size,
    ).toBe(0);
  });

  it('ignores a test that names no requirement', () => {
    expect(parseResults([report([{ fullName: 'plain test', status: 'passed' }])]).size).toBe(0);
  });

  it('refuses a report that is not a Vitest report, rather than silently finding nothing', () => {
    expect(() => parseResults([{ nope: true }])).toThrow(/report/i);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
pnpm --filter @alloy-works/trace test results
```

- [ ] **Step 4: Write `results.ts`**

```ts
import { z } from 'zod';

import { RESERVED_AREA, validate } from './model.js';

export type Outcome = 'passed' | 'failed' | 'skipped';

export interface Verification {
  readonly id: string;
  readonly outcome: Outcome;
  readonly tests: string[];
}

/**
 * The shape Vitest's built-in `json` reporter writes, narrowed to what matters here. Declared rather
 * than trusted: a silently changed reporter format would otherwise show up as every requirement
 * quietly becoming unverified, which is the worst way to learn about it.
 */
const Report = z.object({
  testResults: z.array(
    z.object({
      assertionResults: z.array(z.object({ fullName: z.string(), status: z.string() })),
    }),
  ),
});

const IDENTIFIER = /\b[A-Z]{3}-\d{3}\b/g;

const worst = (outcomes: Outcome[]): Outcome =>
  outcomes.includes('failed') ? 'failed' : outcomes.includes('skipped') ? 'skipped' : 'passed';

const outcomeOf = (status: string): Outcome =>
  status === 'passed' ? 'passed' : status === 'failed' ? 'failed' : 'skipped';

/**
 * Several JSON reports to what each requirement's tests did. One report per package, because each
 * `vitest.config.ts` writes its own.
 */
export function parseResults(reports: unknown[]): Map<string, Verification> {
  const perIdentifier = new Map<string, { outcomes: Outcome[]; tests: string[] }>();

  for (const [index, raw] of reports.entries()) {
    const report = validate(Report, raw, `report ${index + 1}`);
    for (const file of report.testResults) {
      for (const assertion of file.assertionResults) {
        for (const match of assertion.fullName.matchAll(IDENTIFIER)) {
          const id = match[0];
          if (id.slice(0, 3) === RESERVED_AREA) continue;
          const entry = perIdentifier.get(id) ?? { outcomes: [], tests: [] };
          entry.outcomes.push(outcomeOf(assertion.status));
          if (!entry.tests.includes(assertion.fullName)) entry.tests.push(assertion.fullName);
          perIdentifier.set(id, entry);
        }
      }
    }
  }

  return new Map(
    [...perIdentifier].map(([id, entry]) => [
      id,
      { id, outcome: worst(entry.outcomes), tests: entry.tests },
    ]),
  );
}
```

- [ ] **Step 5: Run it and watch it pass**

Expected: PASS, 8 tests.

- [ ] **Step 6: Add the two rungs to `state.ts`**

Extend the type and the trace:

```ts
export type RequirementState =
  'Specified' | 'Designed' | 'Covered' | 'Verified' | 'Withdrawn' | 'Superseded';
```

Add to `Trace`: `readonly citations: Citation[]` and `readonly verification: Verification | undefined`.

Then, in the non-exit branch, the state is the highest rung the evidence supports:

```ts
const citations = model.citations.filter((citation) => citation.id === requirement.id);
const verification = verifications?.get(requirement.id);
const state: RequirementState =
  verification?.outcome === 'passed'
    ? 'Verified'
    : citations.length > 0
      ? 'Covered'
      : design === undefined
        ? 'Specified'
        : 'Designed';
```

Exit states keep their precedence, unchanged, and keep `design` populated as stage 1's fix wave
established. `citations` and `verification` are populated on every branch - a withdrawn requirement
that a test still names is a fact worth being able to see.

Both `traceOf` and `allTraces` take `verifications?: Map<string, Verification>` as an optional
second parameter, so every existing caller keeps working and gets `Covered` but not `Verified`.

- [ ] **Step 7: Extend `state.test.ts`**

Keep every existing test. Add:

```ts
it('is Covered when a test names it, even where no design claims it', () => {
  const cited: TraceModel = {
    ...model,
    citations: [{ id: 'ZZZ-001', file: 'a.test.ts', line: 1, kind: 'title' }],
  };

  expect(traceOf('ZZZ-001', cited)?.state).toBe('Covered');
});

it('is Verified only once the test that names it has actually passed', () => {
  const cited: TraceModel = {
    ...model,
    citations: [{ id: 'ZZZ-001', file: 'a.test.ts', line: 1, kind: 'title' }],
  };
  const passed = new Map([
    ['ZZZ-001', { id: 'ZZZ-001', outcome: 'passed' as const, tests: ['a (ZZZ-001)'] }],
  ]);
  const failed = new Map([
    ['ZZZ-001', { id: 'ZZZ-001', outcome: 'failed' as const, tests: ['a (ZZZ-001)'] }],
  ]);

  expect(traceOf('ZZZ-001', cited, passed)?.state).toBe('Verified');
  expect(traceOf('ZZZ-001', cited, failed)?.state).toBe('Covered');
});

it('does not let a passing test resurrect a superseded requirement', () => {
  const cited: TraceModel = {
    ...model,
    citations: [{ id: 'ZZZ-004', file: 'a.test.ts', line: 1, kind: 'title' }],
  };
  const passed = new Map([
    ['ZZZ-004', { id: 'ZZZ-004', outcome: 'passed' as const, tests: ['a (ZZZ-004)'] }],
  ]);

  expect(traceOf('ZZZ-004', cited, passed)?.state).toBe('Superseded');
});
```

**Prove the last one bites:** move the verification check above the exit checks, confirm it goes red,
restore. Capture the red output.

- [ ] **Step 8: Commit**

```bash
pnpm --filter @alloy-works/trace typecheck
pnpm exec prettier --write packages/trace
git add packages/trace
git commit -m "Add the Covered and Verified rungs, from citations and from a run"
```

---

## Task 5: `trace check` and `trace verify`

**Files:**

- Modify: `packages/trace/src/format.ts`, `packages/trace/src/format.test.ts`,
  `packages/trace/src/cli.ts`

- [ ] **Step 1: Write the failing formatter tests**

Add to `format.test.ts`:

```ts
describe('formatting problems', () => {
  it('says plainly when a corpus has none', () => {
    expect(formatProblems([])).toBe('No problems in the corpus.');
  });

  it('leads with the count, then one line per problem, kind first', () => {
    const output = formatProblems([
      {
        kind: 'cited-undesigned',
        id: 'ZZZ-001',
        detail: 'is named by a.test.ts:1 and claimed by no design',
      },
    ]);

    expect(output).toContain('1 problem');
    expect(output).toContain('cited-undesigned');
    expect(output).toContain('ZZZ-001');
    expect(output).toContain('a.test.ts:1');
  });
});
```

And extend the stats test to cover the two new columns.

- [ ] **Step 2: Run, watch fail, then write the formatters**

Add `formatProblems(found: Problem[]): string` to `format.ts`, and extend `STATES` in `formatStats`
to `['Specified', 'Designed', 'Covered', 'Verified', 'Withdrawn', 'Superseded']`. Extend
`formatTrace` to list the citing tests under the design line, and the verification outcome when one
is supplied.

- [ ] **Step 3: Add the two commands to `cli.ts`**

```
  check              every problem in the corpus: holes, double claims, citations naming nothing
  verify [dir]       states, with Verified computed from the JSON reports in dir
                     (default .trace-results)
```

`check` prints `formatProblems(problems(model))` and **returns 1 when there is any problem**, so it
is usable as a gate later without changing its output. `verify` reads every `*.json` in the
directory, passes them through `parseResults`, and prints the stats table with `Verified` populated;
it fails with a legible sentence when the directory is missing, naming the command that creates it.

- [ ] **Step 4: Run every command against the real corpus and record the output**

```bash
pnpm trace check
pnpm test
pnpm trace verify
pnpm trace show IAM-043
pnpm trace show IAM-018
pnpm trace stats
```

`check` must report `cited-undesigned` for `IAM-018`. `show IAM-043` must list the tests naming it.
After `pnpm test` has written the reports, `verify` must show a non-zero `Verified` column. Put all
of it in your report - these are the outputs that show the chain is closed end to end.

- [ ] **Step 5: Commit**

```bash
pnpm --filter @alloy-works/trace typecheck
pnpm lint
pnpm exec prettier --write packages/trace
git add packages/trace
git commit -m "Report the corpus's problems, and what a run actually verified"
```

---

## Task 6: Wire the reporter, and the paperwork

**Files:**

- Modify: every `vitest.config.ts` (10 of them), `.gitignore`, `.prettierignore`
- Modify: `docs/architecture.md`, `CLAUDE.md`, `docs/testing.md`, `docs/plans/README.md`
- Modify: `CHANGELOG.md`, `version.json`, `package.json`, `apps/desktop/package.json`

- [ ] **Step 1: Add the JSON reporter to every `vitest.config.ts`**

In each, `'json'` goes **after** `'default'`, never instead of it, and each writes its own file named
for the package. Every workspace sits exactly two levels below the repository root - `apps/*`,
`packages/*`, `tests/*` - so the prefix is always `../../`. The file name is the package's directory
name, so nothing collides:

```ts
    reporters: ['default', 'json'],
    outputFile: { json: '../../.trace-results/trace.json' },
```

That example is `packages/trace`'s, and it is the one I verified writes where it says. The other nine
are the same two lines with the name changed: `desktop`, `service`, `web`, `worker`, `api-client`,
`api-contract`, `db`, `domain`, `objects`, `stand-in-idp`, `e2e` - take the list from
`ls */*/vitest.config.ts` rather than from this sentence, since it is the directory that decides.

- [ ] **Step 2: Ignore the results directory**

`.gitignore` and `.prettierignore` both gain `.trace-results/`. The directory is a build artifact of
a test run; committing it would be committing the very thing Task 4 established must not be
committed.

- [ ] **Step 3: Confirm an ordinary test run produces every report**

```bash
rm -rf .trace-results
pnpm test
ls .trace-results/
pnpm trace verify
```

Expected: one JSON file per package that has tests, and `verify` showing a populated `Verified`
column. **Confirm `pnpm test` output is still legible** - the default reporter must still be printing
normally, since it is the reason the array is pinned.

- [ ] **Step 4: Confirm the drift check is unaffected**

```bash
pnpm --filter @alloy-works/trace generate
git status --short
```

Expected: empty. The results files are outside the model by design; if `trace.json` changed here,
something put a result into it.

- [ ] **Step 5: Update the documentation**

- `docs/architecture.md`: the `packages/trace` row gains the citation scan, the check and verify.
- `CLAUDE.md`: add `pnpm trace check` to the commands, and note that a test names the requirement it
  verifies in its `describe`/`it` title - that convention is now load-bearing rather than incidental.
- `docs/testing.md`: describe the citation convention and the `.trace-results/` reports.
- `docs/specification/requirements/README.md`: the "Cite the identifier in whatever verifies it"
  paragraph can now say what reads it, and that `ZZZ` is reserved for fixtures.
- `docs/plans/README.md`: add the stage 2 row to the Traceability table, `Built (PR #NN)`.

- [ ] **Step 6: Bump the version and write the changelog**

`0.11.0` to `0.12.0` in all three mirrors. One entry, `### Added` / `### Changed`, plain hyphens, and
leave `#NN` literal for the pull request number.

- [ ] **Step 7: Verify everything**

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
```

All four must pass. Then commit. **Do not push and do not open a pull request** - a whole-branch
review comes first.

---

## Expected test counts, so a lost test cannot hide

Stage 1 ended with `@alloy-works/trace` at 76 tests across 8 files. This plan adds four files and
extends three. Expect, per file:

| File                      | Tests | Source                                   |
| ------------------------- | ----- | ---------------------------------------- |
| `parse/citations.test.ts` | 11    | Task 1 Step 1                            |
| `check.test.ts`           | 9     | Task 3 Step 1                            |
| `results.test.ts`         | 8     | Task 4 Step 2                            |
| `state.test.ts`           | 10    | 7 from stage 1, plus 3 in Task 4 Step 7  |
| `format.test.ts`          | 14    | 12 from stage 1, plus 2 in Task 5 Step 1 |
| `trace.test.ts`           | 7     | 3 from stage 1, plus 4 in Task 2 Step 1  |
| `requirements.test.ts`    | 21    | 20 from stage 1, plus 1 in Task 1 Step 6 |

Every other file keeps its stage 1 count. That totals **106 across 11 files**. Task 3 Step 5 rewrites
six test bodies without adding or removing a test, so it must not change any number above. If the
total differs, find out why before committing: the arithmetic is here so that a test lost by accident
cannot hide behind a test rewritten on purpose.

## What this plan deliberately leaves undone

- **No baseline and no gate.** `pnpm trace check` returns 1 on a problem, so it is gate-shaped, but
  nothing runs it in CI yet, and no requirement set is declared. Stage 3.
- **No evidence pack.** Stage 3.
- **No intake.** Stage 4.
- **`IAM-018` is reported, not fixed.** Which design should claim it is a design conversation.
- **`Verified` is only as honest as the tests are.** A test named for a requirement that asserts
  nothing still reads as verifying it. The matrix proves linkage; the test-driven discipline is what
  makes linkage mean something, and stage 1's design document says so out loud.
