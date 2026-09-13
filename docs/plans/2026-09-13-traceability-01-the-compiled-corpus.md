# Traceability 1: the compiled corpus

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compile the 1,303 requirements and the designs that claim them into one committed,
drift-checked index, and put a query and search command over it.

**Architecture:** A new `packages/trace` workspace. Every parser is a pure function from document
text to a model, so its tests are template literals and touch no filesystem; `compile.ts` is the
single thin layer that reads files. `trace.json` is generated from the documents, committed, and
compared against a fresh compile by a test - exactly the pattern `packages/api-contract` already runs
for `openapi.json`. The two repository-wide checks that currently scrape the requirements with
regular expressions move here and are rewritten against the parser.

**Tech Stack:** TypeScript, zod 4, Vitest 5, tsx. No new runtime, no new dependency outside those.

**Spec:** [`../superpowers/specs/2026-09-13-requirements-traceability-design.md`](../superpowers/specs/2026-09-13-requirements-traceability-design.md)

This is stage 1 of the four the design proposes. It deliberately stops before citations, so the
states it computes are `Specified`, `Designed`, `Withdrawn` and `Superseded`. `Covered` and
`Verified` arrive in stage 2 with the citation scanner and the Vitest reporter.

## Global Constraints

Copied from the design document and `CLAUDE.md`, and applying to every task below.

- **Test first, always.** Write the failing test, run it, watch it fail, then write the minimal code
  to pass. No production code without a failing test that preceded it.
- **A passing run has no errors or warnings.** `apps/web/src/test/consoleGate.ts` throws from inside
  `console.error` and `console.warn`. Nothing in this plan may print through either.
- **The Vitest reporter is pinned explicitly** in every `vitest.config.ts`: `reporters: ['default']`.
  Left implicit, a run swallows console output on Windows while the identical run on Linux prints it.
- **Parsers take text, never a path.** `compile.ts` is the only module in the package that touches
  the filesystem.
- **No em or en dashes in the changelog.** Plain hyphen `-`. Code, comments and internal docs are
  exempt.
- **Identifier shapes, verbatim:** requirement `^[A-Z]{3}-\d{3}$`, non-requirement
  `^[A-Z]{3}-N\d{2}$`, open question `^[A-Z]{3}-Q\d{2}$`.
- **Tranche vocabulary, verbatim:** `T1`, `T2`, `T3`, `T4`, `T5`, `T6`, `Constraint`.
- **Status vocabulary, verbatim:** `Specified`, `Withdrawn`, `Superseded by XXX-NNN` where `XXX-NNN`
  is a requirement identifier.
- **Corpus counts at the commit this plan was written against:** 1,303 requirements, 112
  non-requirements, 131 open questions, 175 requirements claimed by a design. These are asserted as a
  canary in Task 1 and Task 4; if the corpus has since changed, update the numbers in the same commit
  and say so in the changelog.
- **Version bump for the whole plan:** Minor, `0.10.16` to `0.11.0`, because it is a functional
  enhancement. One bump and one changelog entry for the plan, in Task 7, not per task.
- **`tsconfig.base.json` is strict**, with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
  and `verbatimModuleSyntax`. Index access needs a guard or a `!`; an optional property must be
  declared as `T | undefined` and always present.

---

## File structure

| File                                       | Responsibility                                                       |
| ------------------------------------------ | -------------------------------------------------------------------- |
| `packages/trace/package.json`              | The workspace: scripts `typecheck`, `test`, `generate`, `trace`      |
| `packages/trace/tsconfig.json`             | Typecheck config, extends the base                                   |
| `packages/trace/vitest.config.ts`          | Node environment, pinned reporter                                    |
| `packages/trace/src/model.ts`              | zod schemas and inferred types for everything the model holds        |
| `packages/trace/src/parse/table.ts`        | One markdown table row to its cells                                  |
| `packages/trace/src/parse/requirements.ts` | An area document's text to requirements, non-requirements, questions |
| `packages/trace/src/parse/design.ts`       | A design document's text to the claims it owns                       |
| `packages/trace/src/state.ts`              | The state ladder, pure                                               |
| `packages/trace/src/compile.ts`            | The only module that reads files; produces a `TraceModel`            |
| `packages/trace/src/generate.ts`           | Writes `trace.json`                                                  |
| `packages/trace/src/format.ts`             | Pure string formatting for each command's output                     |
| `packages/trace/src/cli.ts`                | Argument dispatch, thin, calling `compile` and `format`              |
| `packages/trace/trace.json`                | The committed index                                                  |
| `packages/trace/src/trace.test.ts`         | The drift check                                                      |
| `packages/trace/src/requirements.test.ts`  | Moved from `apps/desktop`, rewritten against the parser              |
| `packages/trace/src/design.test.ts`        | Moved from `apps/desktop`, rewritten against the parser              |

---

## Task 1: The workspace, the model and the requirement parser

**Files:**

- Create: `packages/trace/package.json`
- Create: `packages/trace/tsconfig.json`
- Create: `packages/trace/vitest.config.ts`
- Create: `packages/trace/src/model.ts`
- Create: `packages/trace/src/parse/table.ts`
- Create: `packages/trace/src/parse/requirements.ts`
- Test: `packages/trace/src/parse/requirements.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `tableCells(line: string): string[] | undefined`;
  `parseAreaDocument(document: string, text: string): AreaDocument`; the zod schemas and types
  `Requirement`, `NonRequirement`, `Question`, `DesignClaim`, `Design`, `TraceModel`.

- [ ] **Step 1: Create the workspace files**

`packages/trace/package.json`. No `build`, no `main`, no `exports`: nothing imports this package, it
is run through `tsx` and its own tests, and a `dist/` nobody reads is a `dist/` that goes stale.

```json
{
  "name": "@alloy-works/trace",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "generate": "tsx src/generate.ts",
    "trace": "tsx src/cli.ts"
  },
  "dependencies": {
    "zod": "^4.6.1"
  },
  "devDependencies": {
    "@types/node": "^24.5.2",
    "tsx": "^4.23.13",
    "typescript": "^5.9.3",
    "vitest": "^5.0.0"
  }
}
```

`packages/trace/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "vitest.config.ts"]
}
```

`packages/trace/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Pinned rather than left implicit: the default reporter varies by platform, and a run
    // that swallows console output on Windows makes a noisy suite look pristine locally.
    reporters: ['default'],
  },
});
```

Then install, from the repository root:

```bash
pnpm install
```

- [ ] **Step 2: Write the failing parser test**

`packages/trace/src/parse/requirements.test.ts`. Fixtures are invented: area code `ZZZ`, invented
statements. A fixture copied from the real corpus becomes a second source of truth that drifts from
the first.

```ts
import { describe, expect, it } from 'vitest';

import { parseAreaDocument } from './requirements.js';

const document = 'ZZZ-invented-area.md';

describe('parsing an area document', () => {
  it('reads a requirement row into a requirement', () => {
    const text = [
      '# ZZZ - Invented area',
      '',
      '| ID          | Requirement                       | Tranche | Status    |',
      '| ----------- | --------------------------------- | ------- | --------- |',
      '| **ZZZ-001** | A widget must carry its own name  | T1      | Specified |',
      '',
    ].join('\n');

    const parsed = parseAreaDocument(document, text);

    expect(parsed.area).toBe('ZZZ');
    expect(parsed.requirements).toEqual([
      {
        id: 'ZZZ-001',
        area: 'ZZZ',
        statement: 'A widget must carry its own name',
        tranche: 'T1',
        status: 'Specified',
        document,
        line: 5,
      },
    ]);
  });

  it('reads non-requirements and open questions into their own sequences', () => {
    const text = [
      '| **ZZZ-N01** | A widget should not be a gadget |',
      '| **ZZZ-Q01** | Whether a widget may nest | A prototype of two levels |',
    ].join('\n');

    const parsed = parseAreaDocument(document, text);

    expect(parsed.nonRequirements).toEqual([
      { id: 'ZZZ-N01', statement: 'A widget should not be a gadget', document, line: 1 },
    ]);
    expect(parsed.questions).toEqual([
      {
        id: 'ZZZ-Q01',
        question: 'Whether a widget may nest',
        settledBy: 'A prototype of two levels',
        document,
        line: 2,
      },
    ]);
  });

  it('ignores a table row that is not an identifier row', () => {
    const text = [
      '| ID          | Requirement | Tranche | Status |',
      '| ----------- | ----------- | ------- | ------ |',
      '| ZZZ-002     | Not bold, so not a row | T1 | Specified |',
      '| **Concept** | A bolded word that is not an identifier |',
    ].join('\n');

    const parsed = parseAreaDocument(document, text);

    expect(parsed.requirements).toEqual([]);
    expect(parsed.nonRequirements).toEqual([]);
  });

  it('keeps a statement that contains an escaped pipe whole', () => {
    const text = '| **ZZZ-003** | A widget must accept `a \\| b` as one value | T2 | Specified |';

    const parsed = parseAreaDocument(document, text);

    expect(parsed.requirements[0]?.statement).toBe('A widget must accept `a \\| b` as one value');
  });

  it('refuses a tranche outside the vocabulary, naming the document and line', () => {
    const text = '| **ZZZ-004** | A widget must exist | T9 | Specified |';

    expect(() => parseAreaDocument(document, text)).toThrow(/ZZZ-invented-area\.md:1/);
  });

  it('refuses a statement that binds nothing', () => {
    const text = '| **ZZZ-005** | A widget is quite nice | T1 | Specified |';

    expect(() => parseAreaDocument(document, text)).toThrow(/ZZZ-invented-area\.md:1/);
  });

  it('accepts a superseded status and reads its target', () => {
    const text = '| **ZZZ-006** | A widget must spin | T1 | Superseded by ZZZ-007 |';

    expect(parseAreaDocument(document, text).requirements[0]?.status).toBe('Superseded by ZZZ-007');
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
pnpm --filter @alloy-works/trace test
```

Expected: FAIL, `Failed to resolve import "./requirements.js"`.

- [ ] **Step 4: Write the model**

`packages/trace/src/model.ts`:

```ts
import { z } from 'zod';

/** Requirement, non-requirement and open-question identifiers. The shapes are deliberately
 * distinguishable: `ZZZ-N02` and `ZZZ-Q05` cannot be misread as `ZZZ-002`, which is the point of
 * the letter. */
export const REQUIREMENT_ID = /^[A-Z]{3}-\d{3}$/;
export const NON_REQUIREMENT_ID = /^[A-Z]{3}-N\d{2}$/;
export const QUESTION_ID = /^[A-Z]{3}-Q\d{2}$/;
export const AREA_CODE = /^[A-Z]{3}$/;
export const SUPERSEDED_BY = /^Superseded by ([A-Z]{3}-\d{3})$/;

export const TRANCHES = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'Constraint'] as const;

/** `must` is binding, `should` is a strong default an implementer may argue against in a decision
 * record. A row that says neither commits to nothing and is a defect in the corpus, not a state to
 * represent. */
const BINDING = /\b(must|should)\b/;

export const Status = z
  .string()
  .refine(
    (value) => value === 'Specified' || value === 'Withdrawn' || SUPERSEDED_BY.test(value),
    'must be Specified, Withdrawn, or "Superseded by XXX-NNN"',
  );

export const Requirement = z.object({
  id: z.string().regex(REQUIREMENT_ID),
  area: z.string().regex(AREA_CODE),
  statement: z.string().min(1).regex(BINDING, 'must say must or should'),
  tranche: z.enum(TRANCHES),
  status: Status,
  document: z.string().min(1),
  line: z.number().int().positive(),
});
export type Requirement = z.infer<typeof Requirement>;

export const NonRequirement = z.object({
  id: z.string().regex(NON_REQUIREMENT_ID),
  statement: z.string().min(1),
  document: z.string().min(1),
  line: z.number().int().positive(),
});
export type NonRequirement = z.infer<typeof NonRequirement>;

export const Question = z.object({
  id: z.string().regex(QUESTION_ID),
  question: z.string().min(1),
  settledBy: z.string().min(1),
  document: z.string().min(1),
  line: z.number().int().positive(),
});
export type Question = z.infer<typeof Question>;

export const DesignClaim = z.object({
  id: z.string().regex(REQUIREMENT_ID),
  howItIsMet: z.string().min(1),
});
export type DesignClaim = z.infer<typeof DesignClaim>;

export const Design = z.object({
  document: z.string().min(1),
  owns: z.array(DesignClaim),
});
export type Design = z.infer<typeof Design>;

/**
 * Deliberately carries no commit hash and no timestamp. The file is committed, so the commit that
 * holds it IS its provenance - and a hash inside it would change on every commit, which would make
 * the drift check in `trace.test.ts` fail permanently.
 */
export const TraceModel = z.object({
  requirements: z.array(Requirement),
  nonRequirements: z.array(NonRequirement),
  questions: z.array(Question),
  designs: z.array(Design),
});
export type TraceModel = z.infer<typeof TraceModel>;

/** Wraps a schema failure in the one thing a person fixing the corpus needs: where it is. */
export function validate<T>(schema: z.ZodType<T>, value: unknown, where: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const detail = result.error.issues
    .map((issue) => `${issue.path.join('.')} ${issue.message}`)
    .join('; ');
  throw new Error(`${where}: ${detail}`);
}
```

- [ ] **Step 5: Write the table-cell reader**

`packages/trace/src/parse/table.ts`:

```ts
/**
 * One markdown table row to its trimmed cells, or `undefined` when the line is not a table row.
 *
 * Splits on pipes that are not escaped, because a requirement statement is allowed to contain a
 * literal `\|` and a naive split would cut it in half. The previous regular-expression approach in
 * `apps/desktop/src/requirements.test.ts` got this right by accident, through a lazy match anchored
 * at the end of the line; doing it on purpose is the point of having a parser.
 */
export function tableCells(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|') || trimmed.length < 2) return undefined;
  return trimmed
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
}

/** The identifier a row is for, taken from its bolded first cell, or `undefined`. */
export function boldIdentifier(cell: string): string | undefined {
  return /^\*\*([A-Z]{3}-(?:\d{3}|N\d{2}|Q\d{2}))\*\*$/.exec(cell)?.[1];
}
```

- [ ] **Step 6: Write the requirement parser**

`packages/trace/src/parse/requirements.ts`:

```ts
import {
  NON_REQUIREMENT_ID,
  NonRequirement,
  QUESTION_ID,
  Question,
  REQUIREMENT_ID,
  Requirement,
  validate,
} from '../model.js';
import { boldIdentifier, tableCells } from './table.js';

export interface AreaDocument {
  readonly area: string;
  readonly requirements: Requirement[];
  readonly nonRequirements: NonRequirement[];
  readonly questions: Question[];
}

/**
 * An area document's text to the three numbered sequences it holds. Takes text rather than a path
 * so that every test of it is a template literal.
 *
 * A row is only a row when its first cell is a bolded identifier. That excludes the header, the
 * separator, and the tables elsewhere in these documents that bold a concept rather than an
 * identifier - the ownership map in the index being the one that matters.
 */
export function parseAreaDocument(document: string, text: string): AreaDocument {
  const area = document.slice(0, 3);
  const requirements: Requirement[] = [];
  const nonRequirements: NonRequirement[] = [];
  const questions: Question[] = [];

  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const cells = tableCells(line);
    if (cells === undefined) continue;
    const first = cells[0];
    if (first === undefined) continue;
    const id = boldIdentifier(first);
    if (id === undefined) continue;

    const at = index + 1;
    const where = `${document}:${at}`;

    if (REQUIREMENT_ID.test(id) && cells.length === 4) {
      requirements.push(
        validate(
          Requirement,
          {
            id,
            area: id.slice(0, 3),
            statement: cells[1],
            tranche: cells[2],
            status: cells[3],
            document,
            line: at,
          },
          where,
        ),
      );
    } else if (NON_REQUIREMENT_ID.test(id) && cells.length === 2) {
      nonRequirements.push(
        validate(NonRequirement, { id, statement: cells[1], document, line: at }, where),
      );
    } else if (QUESTION_ID.test(id) && cells.length === 3) {
      questions.push(
        validate(
          Question,
          { id, question: cells[1], settledBy: cells[2], document, line: at },
          where,
        ),
      );
    }
  }

  return { area, requirements, nonRequirements, questions };
}
```

- [ ] **Step 7: Run the test and watch it pass**

```bash
pnpm --filter @alloy-works/trace test
```

Expected: PASS, 7 tests.

- [ ] **Step 8: Add the real-corpus canary**

The parser must agree with the corpus it will be run against, and a template-literal fixture cannot
tell you that. Two edits to `packages/trace/src/parse/requirements.test.ts`: the two `node:` imports
go at the **top** of the file, above the `vitest` import; the `describe` block goes at the **end**.

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The one test here that reads the disk. It exists because the fixtures above cannot catch a
 * disagreement between this parser and the 1,303 rows it replaces a regular expression over: a
 * statement shaped in a way the cell splitter mishandles would simply go missing, silently.
 */
describe('the real corpus', () => {
  const directory = join(process.cwd(), '..', '..', 'docs', 'specification', 'requirements');
  const areas = readdirSync(directory)
    .filter((name) => /^[A-Z]{3}-.+\.md$/.test(name))
    .sort();
  const parsed = areas.map((name) =>
    parseAreaDocument(name, readFileSync(join(directory, name), 'utf8')),
  );
  const total = (pick: (document: AreaDocument) => unknown[]): number =>
    parsed.reduce((count, document) => count + pick(document).length, 0);

  it('parses every area document without refusing a row', () => {
    expect(areas).toHaveLength(21);
  });

  it('finds exactly the corpus this plan was written against', () => {
    expect(total((document) => document.requirements)).toBe(1303);
    expect(total((document) => document.nonRequirements)).toBe(112);
    expect(total((document) => document.questions)).toBe(131);
  });
});
```

Add `AreaDocument` to the import at the top of the file:

```ts
import { type AreaDocument, parseAreaDocument } from './requirements.js';
```

- [ ] **Step 9: Run it**

```bash
pnpm --filter @alloy-works/trace test
```

Expected: PASS. **If the counts differ**, the corpus has changed since this plan was written. Check
the difference is real - `git log --oneline -- docs/specification/requirements/` - then update the
three numbers here and in the Global Constraints, and say so in the changelog in Task 7. Do not
adjust the parser to reach a number.

- [ ] **Step 10: Typecheck, lint and commit**

```bash
pnpm --filter @alloy-works/trace typecheck
pnpm lint
pnpm exec prettier --write packages/trace
```

```bash
git add packages/trace pnpm-lock.yaml
git commit -m "Parse an area document into requirements, rather than scraping it"
```

---

## Task 2: The design-claim parser

**Files:**

- Create: `packages/trace/src/parse/design.ts`
- Test: `packages/trace/src/parse/design.test.ts`

**Interfaces:**

- Consumes: `tableCells`, `boldIdentifier` from `./table.js`; `Design`, `DesignClaim`, `validate`
  from `../model.js`.
- Produces: `parseDesignDocument(document: string, text: string): Design`.

- [ ] **Step 1: Write the failing test**

`packages/trace/src/parse/design.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { parseDesignDocument } from './design.js';

const document = 'invented-subsystem.md';

describe('parsing a design document', () => {
  it('reads the claims in the Requirements owned section', () => {
    const text = [
      '# Invented subsystem',
      '',
      '## Requirements owned',
      '',
      '| ID          | How it is met            |',
      '| ----------- | ------------------------ |',
      '| **ZZZ-001** | A column holds the name  |',
      '| **ZZZ-002** | The row is never updated |',
      '',
      '## Traceability',
      '',
      '| **ZZZ-003** | Mentioned after the section, so not claimed |',
    ].join('\n');

    expect(parseDesignDocument(document, text)).toEqual({
      document,
      owns: [
        { id: 'ZZZ-001', howItIsMet: 'A column holds the name' },
        { id: 'ZZZ-002', howItIsMet: 'The row is never updated' },
      ],
    });
  });

  it('claims nothing when the document has no Requirements owned section', () => {
    const text = '# Invented subsystem\n\nProse, and an identifier ZZZ-004 mentioned in it.\n';

    expect(parseDesignDocument(document, text)).toEqual({ document, owns: [] });
  });

  it('does not treat an identifier in prose inside the section as a claim', () => {
    const text = [
      '## Requirements owned',
      '',
      'This subsystem also relates to ZZZ-009, which it does not own.',
      '',
      '| **ZZZ-005** | The only claim |',
    ].join('\n');

    expect(parseDesignDocument(document, text).owns).toEqual([
      { id: 'ZZZ-005', howItIsMet: 'The only claim' },
    ]);
  });

  it('refuses a claim that explains nothing', () => {
    const text = '## Requirements owned\n\n| **ZZZ-006** |  |';

    expect(() => parseDesignDocument(document, text)).toThrow(/invented-subsystem\.md:3/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @alloy-works/trace test design
```

Expected: FAIL, `Failed to resolve import "./design.js"`.

- [ ] **Step 3: Write the parser**

`packages/trace/src/parse/design.ts`:

```ts
import { DesignClaim, type Design, REQUIREMENT_ID, validate } from '../model.js';
import { boldIdentifier, tableCells } from './table.js';

const HEADING = '## Requirements owned';

/**
 * A design document's text to the requirements it claims.
 *
 * Only the `## Requirements owned` section counts. A design document mentions plenty of identifiers
 * in its prose, and mentioning one is not claiming it - which is the distinction the whole reverse
 * index rests on.
 */
export function parseDesignDocument(document: string, text: string): Design {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === HEADING);
  if (start === -1) return { document, owns: [] };

  const owns: DesignClaim[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.startsWith('## ')) break;

    const cells = tableCells(line);
    if (cells === undefined || cells.length !== 2) continue;
    const first = cells[0];
    if (first === undefined) continue;
    const id = boldIdentifier(first);
    if (id === undefined || !REQUIREMENT_ID.test(id)) continue;

    owns.push(validate(DesignClaim, { id, howItIsMet: cells[1] }, `${document}:${index + 1}`));
  }

  return { document, owns };
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
pnpm --filter @alloy-works/trace test design
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm --filter @alloy-works/trace typecheck
pnpm exec prettier --write packages/trace
git add packages/trace
git commit -m "Read what a design claims from the section that claims it"
```

---

## Task 3: The state ladder

**Files:**

- Create: `packages/trace/src/state.ts`
- Test: `packages/trace/src/state.test.ts`

**Interfaces:**

- Consumes: `TraceModel`, `Requirement`, `SUPERSEDED_BY` from `./model.js`.
- Produces: `type RequirementState = 'Specified' | 'Designed' | 'Withdrawn' | 'Superseded'`;
  `interface Trace { requirement: Requirement; state: RequirementState; design: string | undefined; supersededBy: string | undefined }`;
  `traceOf(id: string, model: TraceModel): Trace | undefined`;
  `allTraces(model: TraceModel): Trace[]`.

- [ ] **Step 1: Write the failing test**

`packages/trace/src/state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { Requirement, TraceModel } from './model.js';
import { allTraces, traceOf } from './state.js';

const requirement = (id: string, status: string): Requirement => ({
  id,
  area: id.slice(0, 3),
  statement: 'A widget must exist',
  tranche: 'T1',
  status,
  document: 'ZZZ-invented-area.md',
  line: 1,
});

const model: TraceModel = {
  requirements: [
    requirement('ZZZ-001', 'Specified'),
    requirement('ZZZ-002', 'Specified'),
    requirement('ZZZ-003', 'Withdrawn'),
    requirement('ZZZ-004', 'Superseded by ZZZ-002'),
  ],
  nonRequirements: [],
  questions: [],
  designs: [
    { document: 'invented-subsystem.md', owns: [{ id: 'ZZZ-002', howItIsMet: 'A column' }] },
  ],
};

describe('the state of a requirement', () => {
  it('is Specified when nothing claims it', () => {
    expect(traceOf('ZZZ-001', model)?.state).toBe('Specified');
  });

  it('is Designed when a design claims it, and names the design', () => {
    const trace = traceOf('ZZZ-002', model);

    expect(trace?.state).toBe('Designed');
    expect(trace?.design).toBe('invented-subsystem.md');
  });

  // Leaving the ladder is the whole point of keeping the row: a withdrawn requirement is not a gap.
  it('is Withdrawn rather than Specified, so it never reads as an unmet requirement', () => {
    const trace = traceOf('ZZZ-003', model);

    expect(trace?.state).toBe('Withdrawn');
    expect(trace?.design).toBeUndefined();
  });

  it('is Superseded, and names what superseded it', () => {
    const trace = traceOf('ZZZ-004', model);

    expect(trace?.state).toBe('Superseded');
    expect(trace?.supersededBy).toBe('ZZZ-002');
  });

  it('is nothing at all for an identifier the corpus does not hold', () => {
    expect(traceOf('ZZZ-999', model)).toBeUndefined();
  });

  it('traces every requirement in the model, in order', () => {
    expect(allTraces(model).map((trace) => [trace.requirement.id, trace.state])).toEqual([
      ['ZZZ-001', 'Specified'],
      ['ZZZ-002', 'Designed'],
      ['ZZZ-003', 'Withdrawn'],
      ['ZZZ-004', 'Superseded'],
    ]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @alloy-works/trace test state
```

Expected: FAIL, `Failed to resolve import "./state.js"`.

- [ ] **Step 3: Write the ladder**

`packages/trace/src/state.ts`:

```ts
import { type Requirement, SUPERSEDED_BY, type TraceModel } from './model.js';

/**
 * The rungs stage 1 can compute. `Covered` and `Verified` arrive in stage 2, when citations and test
 * results exist to compute them from.
 *
 * `Withdrawn` and `Superseded` are not rungs but exits: a requirement in either state has left the
 * ladder, and counting it as a gap would be the opposite of what keeping its row is for.
 */
export type RequirementState = 'Specified' | 'Designed' | 'Withdrawn' | 'Superseded';

export interface Trace {
  readonly requirement: Requirement;
  readonly state: RequirementState;
  readonly design: string | undefined;
  readonly supersededBy: string | undefined;
}

function designClaiming(id: string, model: TraceModel): string | undefined {
  return model.designs.find((design) => design.owns.some((claim) => claim.id === id))?.document;
}

function trace(requirement: Requirement, model: TraceModel): Trace {
  const supersededBy = SUPERSEDED_BY.exec(requirement.status)?.[1];
  if (supersededBy !== undefined) {
    return { requirement, state: 'Superseded', design: undefined, supersededBy };
  }
  if (requirement.status === 'Withdrawn') {
    return { requirement, state: 'Withdrawn', design: undefined, supersededBy: undefined };
  }
  const design = designClaiming(requirement.id, model);
  return {
    requirement,
    state: design === undefined ? 'Specified' : 'Designed',
    design,
    supersededBy: undefined,
  };
}

export function traceOf(id: string, model: TraceModel): Trace | undefined {
  const requirement = model.requirements.find((candidate) => candidate.id === id);
  return requirement === undefined ? undefined : trace(requirement, model);
}

export function allTraces(model: TraceModel): Trace[] {
  return model.requirements.map((requirement) => trace(requirement, model));
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
pnpm --filter @alloy-works/trace test state
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm --filter @alloy-works/trace typecheck
pnpm exec prettier --write packages/trace
git add packages/trace
git commit -m "Compute a requirement's state from what cites it"
```

---

## Task 4: Compile, commit the index, and check it for drift

**Files:**

- Create: `packages/trace/src/compile.ts`
- Create: `packages/trace/src/generate.ts`
- Create: `packages/trace/trace.json` (generated)
- Test: `packages/trace/src/trace.test.ts`
- Modify: `.prettierignore`
- Modify: `package.json` (root scripts)
- Modify: `docs/superpowers/specs/2026-09-13-requirements-traceability-design.md` (section 8)

**Interfaces:**

- Consumes: `parseAreaDocument`, `parseDesignDocument`, `TraceModel`.
- Produces: `compile(repoRoot: string): TraceModel`; `REPO_ROOT`; the committed `trace.json`.

- [ ] **Step 1: Correct the design document first**

Writing this task found a defect in the spec: section 8's example model carries `sha` and
`generatedAt`. Both would change on every commit, so the drift check could never pass. The commit
holding the file is its provenance, which is better evidence anyway. Remove both keys from the
example in `docs/superpowers/specs/2026-09-13-requirements-traceability-design.md` and add one
sentence after the code block:

```markdown
The model deliberately carries no commit hash and no timestamp. The commit that holds the file is its
provenance, and a hash inside it would change on every commit, which would make the drift check
impossible to pass. The evidence pack in stage 3 records the tag and the commit it was built from.
```

Commit that on its own, so the correction is legible:

```bash
git add docs/superpowers/specs/2026-09-13-requirements-traceability-design.md
git commit -m "Keep the commit hash out of the model it would make uncheckable"
```

- [ ] **Step 2: Write the failing drift test**

`packages/trace/src/trace.test.ts`:

```ts
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, compile } from './compile.js';
import { TraceModel } from './model.js';

describe('the committed trace.json', () => {
  const committed: unknown = JSON.parse(
    readFileSync(new URL('../trace.json', import.meta.url), 'utf8'),
  );

  it('is exactly what the documents compile to - run `pnpm --filter @alloy-works/trace generate` if not', () => {
    expect(committed).toEqual(compile(REPO_ROOT));
  });

  it('is a model of the shape the schema describes', () => {
    expect(() => TraceModel.parse(committed)).not.toThrow();
  });

  it('holds the corpus this plan was written against', () => {
    const model = TraceModel.parse(committed);

    expect(model.requirements).toHaveLength(1303);
    expect(model.nonRequirements).toHaveLength(112);
    expect(model.questions).toHaveLength(131);
    expect(
      new Set(model.designs.flatMap((design) => design.owns.map((claim) => claim.id))).size,
    ).toBe(175);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
pnpm --filter @alloy-works/trace test trace
```

Expected: FAIL, `Failed to resolve import "./compile.js"`.

- [ ] **Step 4: Write the compiler**

`packages/trace/src/compile.ts`. This is the only module in the package that touches the filesystem.

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { TraceModel } from './model.js';
import { parseDesignDocument } from './parse/design.js';
import { parseAreaDocument } from './parse/requirements.js';

/** `packages/trace` is two levels down, and every command runs from its own package directory. */
export const REPO_ROOT = join(process.cwd(), '..', '..');

const AREA_DOCUMENT = /^[A-Z]{3}-.+\.md$/;

const read = (...parts: string[]): string => readFileSync(join(...parts), 'utf8');

/** Sorted so that the committed file is a function of the documents and not of directory order. */
const documentsIn = (directory: string, matches: (name: string) => boolean): string[] =>
  readdirSync(directory).filter(matches).sort();

export function compile(repoRoot: string): TraceModel {
  const requirementsDir = join(repoRoot, 'docs', 'specification', 'requirements');
  const designDir = join(repoRoot, 'docs', 'design');

  const areas = documentsIn(requirementsDir, (name) => AREA_DOCUMENT.test(name)).map((name) =>
    parseAreaDocument(name, read(requirementsDir, name)),
  );

  const designs = documentsIn(
    designDir,
    (name) => name.endsWith('.md') && name !== 'README.md',
  ).map((name) => parseDesignDocument(name, read(designDir, name)));

  return {
    requirements: areas.flatMap((area) => area.requirements),
    nonRequirements: areas.flatMap((area) => area.nonRequirements),
    questions: areas.flatMap((area) => area.questions),
    designs,
  };
}
```

- [ ] **Step 5: Write the generator**

`packages/trace/src/generate.ts`:

```ts
// Rewrites trace.json from the requirement and design documents. The file is committed so that a
// change to the corpus is a change in a diff a reviewer reads, and so that an auditor reading a tag
// gets the model without running anything. `trace.test.ts` fails when the two drift apart.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { REPO_ROOT, compile } from './compile.js';

const file = new URL('../trace.json', import.meta.url);
writeFileSync(file, `${JSON.stringify(compile(REPO_ROOT), null, 2)}\n`);
console.log(`Wrote ${fileURLToPath(file)}`);
```

- [ ] **Step 6: Generate the index and run the test**

```bash
pnpm --filter @alloy-works/trace generate
pnpm --filter @alloy-works/trace test trace
```

Expected: PASS, 3 tests. If the three counts differ from 1,303 / 112 / 131 / 175, apply the same rule
as Task 1 Step 9: confirm the corpus really changed, update the numbers, and say so in the changelog.

- [ ] **Step 7: Keep Prettier off the generated file**

Prettier and the generator would each reformat what the other wrote, and the drift test would fail
on whichever ran last. `openapi.json` is already excluded for the same reason. Append to
`.prettierignore`:

```
# Generated from the requirement and design documents by
# `pnpm --filter @alloy-works/trace generate`, and compared with a fresh compile in a test:
# formatting it would make that comparison fail.
packages/trace/trace.json
```

- [ ] **Step 8: Add the root script**

In the root `package.json`, add to `scripts`, after `"dev:setup"`:

```json
    "trace": "pnpm --filter @alloy-works/trace trace --",
```

- [ ] **Step 9: Verify the whole repository is still clean**

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
```

Expected: all pass. `pnpm test` now includes `@alloy-works/trace`.

- [ ] **Step 10: Commit**

```bash
git add packages/trace .prettierignore package.json
git commit -m "Compile the corpus into one committed index, checked for drift"
```

---

## Task 5: The query and search command

**Files:**

- Create: `packages/trace/src/format.ts`
- Create: `packages/trace/src/cli.ts`
- Test: `packages/trace/src/format.test.ts`

**Interfaces:**

- Consumes: `TraceModel`, `allTraces`, `traceOf`, `compile`, `REPO_ROOT`.
- Produces: `formatTrace(trace: Trace): string`; `search(model: TraceModel, term: string): Requirement[]`;
  `formatSearch(results: Requirement[], term: string): string`; `formatStats(model: TraceModel): string`;
  `nextIdentifier(model: TraceModel, area: string): string`.

- [ ] **Step 1: Write the failing test**

`packages/trace/src/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { Requirement, TraceModel } from './model.js';
import { formatSearch, formatStats, formatTrace, nextIdentifier, search } from './format.js';
import { traceOf } from './state.js';

const requirement = (
  id: string,
  statement: string,
  tranche: Requirement['tranche'],
): Requirement => ({
  id,
  area: id.slice(0, 3),
  statement,
  tranche,
  status: 'Specified',
  document: 'ZZZ-invented-area.md',
  line: 7,
});

const model: TraceModel = {
  requirements: [
    requirement('ZZZ-001', 'A widget must carry a footnote', 'T1'),
    requirement('ZZZ-002', 'A gadget must spin freely', 'T2'),
    requirement('ZZZ-003', 'A footnote must survive a move', 'Constraint'),
  ],
  nonRequirements: [],
  questions: [],
  designs: [
    { document: 'invented-subsystem.md', owns: [{ id: 'ZZZ-001', howItIsMet: 'A column' }] },
  ],
};

describe('formatting one requirement', () => {
  it('names the statement, the tranche, the state and the owning design', () => {
    const output = formatTrace(traceOf('ZZZ-001', model)!);

    expect(output).toContain('ZZZ-001');
    expect(output).toContain('A widget must carry a footnote');
    expect(output).toContain('T1');
    expect(output).toContain('Designed');
    expect(output).toContain('invented-subsystem.md');
    expect(output).toContain('ZZZ-invented-area.md:7');
  });

  it('says plainly that nothing designs a specified requirement', () => {
    expect(formatTrace(traceOf('ZZZ-002', model)!)).toContain('no design claims it');
  });
});

describe('searching statements', () => {
  it('finds every requirement whose statement holds the term, case-insensitively', () => {
    expect(search(model, 'FOOTNOTE').map((found) => found.id)).toEqual(['ZZZ-001', 'ZZZ-003']);
  });

  it('finds nothing for a term the corpus does not use', () => {
    expect(search(model, 'flywheel')).toEqual([]);
  });

  it('says so plainly when a search finds nothing, rather than printing an empty list', () => {
    expect(formatSearch(search(model, 'flywheel'), 'flywheel')).toBe(
      'Nothing in the corpus mentions "flywheel".',
    );
  });

  it('lists what it found, with the count first', () => {
    const output = formatSearch(search(model, 'footnote'), 'footnote');

    expect(output).toContain('2 requirement(s)');
    expect(output).toContain('ZZZ-001');
    expect(output).toContain('ZZZ-003');
  });
});

describe('the summary', () => {
  it('leads with the size of the corpus', () => {
    expect(formatStats(model)).toContain('3 requirements, 0 non-requirements, 0 open questions');
  });

  it('counts each tranche against each state, in fixed-width columns', () => {
    const lines = formatStats(model).split(/\r?\n/);
    const row = (tranche: string): string[] =>
      lines
        .find((line) => line.startsWith(tranche))!
        .trim()
        .split(/\s+/);

    // Columns are Specified, Designed, Withdrawn, Superseded, in that order.
    expect(row('T1')).toEqual(['T1', '0', '1', '0', '0']);
    expect(row('T2')).toEqual(['T2', '1', '0', '0', '0']);
    expect(row('Constraint')).toEqual(['Constraint', '1', '0', '0', '0']);
  });
});

describe('allocating the next identifier', () => {
  it('takes the next number after the highest in the area, not the count', () => {
    expect(nextIdentifier(model, 'ZZZ')).toBe('ZZZ-004');
  });

  it('refuses an area the corpus does not hold, rather than inventing one', () => {
    expect(() => nextIdentifier(model, 'QQQ')).toThrow(/QQQ/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @alloy-works/trace test format
```

Expected: FAIL, `Failed to resolve import "./format.js"`.

- [ ] **Step 3: Write the formatters**

`packages/trace/src/format.ts`:

```ts
import type { Requirement, TraceModel } from './model.js';
import { type RequirementState, type Trace, allTraces } from './state.js';

const STATES: RequirementState[] = ['Specified', 'Designed', 'Withdrawn', 'Superseded'];

export function formatTrace(trace: Trace): string {
  const { requirement } = trace;
  const lines = [
    `${requirement.id}  ${requirement.tranche}  ${trace.state}`,
    '',
    requirement.statement,
    '',
    `  specified  ${requirement.document}:${requirement.line}`,
    `  design     ${trace.design ?? 'no design claims it'}`,
  ];
  if (trace.supersededBy !== undefined) lines.push(`  superseded by ${trace.supersededBy}`);
  return lines.join('\n');
}

export function search(model: TraceModel, term: string): Requirement[] {
  const needle = term.toLowerCase();
  return model.requirements.filter((requirement) =>
    requirement.statement.toLowerCase().includes(needle),
  );
}

export function formatSearch(results: Requirement[], term: string): string {
  if (results.length === 0) return `Nothing in the corpus mentions "${term}".`;
  const rows = results.map(
    (found) => `${found.id}  ${found.tranche.padEnd(10)}  ${found.statement}`,
  );
  return [`${results.length} requirement(s) mention "${term}":`, '', ...rows].join('\n');
}

export function formatStats(model: TraceModel): string {
  const traces = allTraces(model);
  const tranches = [...new Set(traces.map((trace) => trace.requirement.tranche))].sort();
  const header = ['Tranche'.padEnd(12), ...STATES.map((state) => state.padStart(11))].join('');
  const rows = tranches.map((tranche) => {
    const inTranche = traces.filter((trace) => trace.requirement.tranche === tranche);
    const counts = STATES.map((state) =>
      String(inTranche.filter((trace) => trace.state === state).length).padStart(11),
    );
    return [tranche.padEnd(12), ...counts].join('');
  });
  return [
    `${model.requirements.length} requirements, ${model.nonRequirements.length} non-requirements, ${model.questions.length} open questions`,
    '',
    header,
    ...rows,
  ].join('\n');
}

/**
 * The next number after the highest allocated, never the count. Identifiers are contiguous as a set
 * and withdrawn rows are kept, so counting would reissue one - and an identifier is only worth
 * citing if it means exactly one thing for ever.
 */
export function nextIdentifier(model: TraceModel, area: string): string {
  const numbers = model.requirements
    .filter((requirement) => requirement.area === area)
    .map((requirement) => Number.parseInt(requirement.id.slice(4), 10));
  if (numbers.length === 0) throw new Error(`No area ${area} in the corpus.`);
  return `${area}-${String(Math.max(...numbers) + 1).padStart(3, '0')}`;
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
pnpm --filter @alloy-works/trace test format
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Write the command shell**

`packages/trace/src/cli.ts`. Thin on purpose: every decision worth testing is in `format.ts` and
`state.ts`, and this only dispatches and prints.

```ts
// The query surface over the committed corpus. Thin by design: what is worth testing lives in
// format.ts and state.ts, which are pure and tested without a process.
import { REPO_ROOT, compile } from './compile.js';
import { formatSearch, formatStats, formatTrace, nextIdentifier, search } from './format.js';
import { allTraces, traceOf } from './state.js';

const USAGE = `pnpm trace <command>

  show <ID>          one requirement: its statement, tranche, state and owning design
  search <term>      every requirement whose statement mentions the term
  area <XXX>         every requirement in an area, with its state
  next <XXX>         the next free identifier in an area
  stats              the whole corpus, by tranche and state
`;

function main(argv: string[]): number {
  const [command, argument] = argv;
  const model = compile(REPO_ROOT);

  switch (command) {
    case 'show': {
      if (argument === undefined) return fail('show needs an identifier, such as CNT-014.');
      const trace = traceOf(argument.toUpperCase(), model);
      if (trace === undefined) return fail(`No requirement ${argument} in the corpus.`);
      console.log(formatTrace(trace));
      return 0;
    }
    case 'search': {
      if (argument === undefined) return fail('search needs a term.');
      console.log(formatSearch(search(model, argument), argument));
      return 0;
    }
    case 'area': {
      if (argument === undefined) return fail('area needs a three-letter code, such as CNT.');
      const area = argument.toUpperCase();
      const traces = allTraces(model).filter((trace) => trace.requirement.area === area);
      if (traces.length === 0) return fail(`No area ${area} in the corpus.`);
      for (const trace of traces) {
        console.log(
          `${trace.requirement.id}  ${trace.state.padEnd(10)}  ${trace.requirement.statement}`,
        );
      }
      return 0;
    }
    case 'next': {
      if (argument === undefined) return fail('next needs a three-letter code, such as CNT.');
      console.log(nextIdentifier(model, argument.toUpperCase()));
      return 0;
    }
    case 'stats': {
      console.log(formatStats(model));
      return 0;
    }
    default:
      console.log(USAGE);
      return command === undefined ? 0 : 1;
  }
}

/** Writes to stdout, not stderr: `consoleGate` throws from console.error by design. */
function fail(message: string): number {
  console.log(message);
  return 1;
}

process.exitCode = main(process.argv.slice(2));
```

- [ ] **Step 6: Run every command against the real corpus**

```bash
pnpm trace stats
pnpm trace show VER-001
pnpm trace show iam-018
pnpm trace search footnote
pnpm trace next CNT
pnpm trace area VER
pnpm trace
```

Expected: `stats` prints 1,303 with a row per tranche; `show VER-001` names
`storage-and-versioning.md`; `show iam-018` prints `no design claims it`, which is the finding the
design document records; `next CNT` prints one identifier above the highest `CNT`; the bare command
prints usage and exits 0.

**If `pnpm trace show VER-001` fails on argument handling**, pnpm is not forwarding past the script.
Run `pnpm --filter @alloy-works/trace trace show VER-001` to confirm the command itself works, then
fix the root script's `--` rather than the CLI.

- [ ] **Step 7: Typecheck, lint and commit**

```bash
pnpm --filter @alloy-works/trace typecheck
pnpm lint
pnpm exec prettier --write packages/trace
git add packages/trace
git commit -m "Query the corpus without reading twenty-one documents"
```

---

## Task 6: Move the two repository-wide checks into the package

**Files:**

- Create: `packages/trace/src/requirements.test.ts` (from `apps/desktop/src/requirements.test.ts`)
- Create: `packages/trace/src/design.test.ts` (from `apps/desktop/src/design.test.ts`)
- Delete: `apps/desktop/src/requirements.test.ts`
- Delete: `apps/desktop/src/design.test.ts`
- Modify: `apps/desktop/src/decisions.test.ts` (the comment that counts these checks)

**Interfaces:**

- Consumes: `compile`, `REPO_ROOT`, `parseAreaDocument`, `TraceModel`.
- Produces: nothing new. The point is that no assertion is lost.

Both files carry a comment saying these checks want a workspace of their own once there are three or
four of them. There are four. Every assertion they make must survive the move; the only thing that
changes is that they ask the parser instead of scraping with a regular expression.

- [ ] **Step 1: Move both files with git, so the history follows**

```bash
git mv apps/desktop/src/requirements.test.ts packages/trace/src/requirements.test.ts
git mv apps/desktop/src/design.test.ts packages/trace/src/design.test.ts
```

- [ ] **Step 2: Run them where they now live and watch them fail**

```bash
pnpm --filter @alloy-works/trace test
```

Expected: FAIL. `repoRoot` resolves the same - both packages sit two levels down - but
`requirements.test.ts` reads `README.md` out of the requirements directory through its own `read`
helper and both files declare their own regular expressions, which is what this task removes.

- [ ] **Step 3: Rewrite the requirements check against the model**

Replace the top of `packages/trace/src/requirements.test.ts` - the `repoRoot`, `read`,
`areaDocuments`, the four regular expressions, the `Requirement` interface, `requirementsIn`,
`allRequirements`, `KNOWN_TRANCHE` and `KNOWN_STATUS` declarations - with:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, compile } from './compile.js';
import { SUPERSEDED_BY } from './model.js';

/**
 * The detailed requirements, and the identifiers work is tracked against.
 *
 * A requirement identifier is only worth citing from a commit or a test if it means exactly one
 * thing for ever. A duplicate, a renumbering, or a silent gap breaks every citation that already
 * exists, and breaks it quietly - the citation still reads fine, it just now points somewhere else.
 * So the properties that make an identifier trustworthy are pinned here rather than left to care.
 *
 * The shapes and vocabularies these used to assert are now refused by the parser itself, at the
 * document and line that holds the offending row, which is a better failure than a test naming a
 * value. What is left here is everything the parser cannot see from one row: uniqueness across the
 * corpus, contiguity within an area, and the index agreeing with the documents.
 */
const requirementsDir = join(REPO_ROOT, 'docs', 'specification', 'requirements');
const read = (name: string): string => readFileSync(join(requirementsDir, name), 'utf8');

const model = compile(REPO_ROOT);
const allRequirements = model.requirements;
const areaDocuments = [
  ...new Set(allRequirements.map((requirement) => requirement.document)),
].sort();
```

Then work down the file and, for each existing `it(...)`, keep the assertion and source its data from
`model` instead of from a regular expression:

- **Keep unchanged**, they already read `allRequirements`: `never issues the same identifier twice`;
  `keeps every requirement under the area code of the document holding it`;
  `points every superseding status at a requirement that exists` - replace its inline
  `/^Superseded by ([A-Z]{3}-\d{3})$/` with the imported `SUPERSEDED_BY`;
  `numbers each area from 001 with no gap and no repeat`, whose body becomes:

```ts
for (const name of areaDocuments) {
  const numbers = allRequirements
    .filter((requirement) => requirement.document === name)
    .map((requirement) => Number.parseInt(requirement.id.slice(4), 10))
    .sort((left, right) => left - right);

  expect(numbers, `${name} numbers contiguously`).toEqual(numbers.map((_, index) => index + 1));
}
```

- **Delete four tests that the parser now refuses outright**, because a test that cannot fail is
  worse than no test: `gives every requirement an identifier of the one permitted shape`,
  `gives every requirement a tranche we recognise`, `gives every requirement a status we recognise`,
  and `states something binding in every requirement`. Add one test in their place that pins the
  parser is doing that job:

```ts
it('refuses a malformed row at the document and line holding it', async () => {
  const { parseAreaDocument } = await import('./parse/requirements.js');

  expect(() =>
    parseAreaDocument('ZZZ-invented.md', '| **ZZZ-001** | No verb here | T1 | Specified |'),
  ).toThrow(/ZZZ-invented\.md:1/);
});
```

- **Keep the whole of `describe('the requirements index')`** unchanged; it reads `README.md` through
  `read`, which still exists. Its `lists every area document that has been written` assertion now
  compares against the `areaDocuments` derived from the model, which is the same list.
- **Keep `describe('the numbered non-requirements and open questions')`**, deleting its
  `cannot be mistaken for a requirement identifier` test, which the parser now refuses, and replacing
  its `collect` helper and the loop header with:

```ts
  for (const [label, rows, offset] of [
    ['non-requirement', model.nonRequirements, 5],
    ['open question', model.questions, 5],
  ] as const) {
    describe(`${label}s`, () => {
```

Each row already carries `id` and `document`, which is everything the four surviving assertions in
that block read. `offset` is where the two digits start in `ZZZ-N01`, replacing the hard-coded
`row.id.slice(5)`.

- **Keep the whole of `describe('the ownership map')`** unchanged.

- [ ] **Step 4: Rewrite the design check against the model**

In `packages/trace/src/design.test.ts`, replace the `designDir`, `read`, `designDocuments`,
`REQUIREMENT_ROW`, `knownRequirements`, `OWNED_ROW`, `between`, `ownedBy` and `ownership`
declarations with:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, compile } from './compile.js';

const designDir = join(REPO_ROOT, 'docs', 'design');
const read = (name: string): string => readFileSync(join(designDir, name), 'utf8');

const model = compile(REPO_ROOT);
const knownRequirements = new Set(model.requirements.map((requirement) => requirement.id));
const designDocuments = model.designs.map((design) => design.document);
const ownedBy = (document: string): string[] =>
  model.designs.find((design) => design.document === document)?.owns.map((claim) => claim.id) ?? [];

const ownership = new Map<string, string[]>();
for (const design of model.designs) {
  for (const claim of design.owns) {
    ownership.set(claim.id, [...(ownership.get(claim.id) ?? []), design.document]);
  }
}
```

Every `it(...)` in the file then works unchanged. Keep all seven.

- [ ] **Step 5: Correct the comment in the check that stays behind**

Three header comments now describe a neighbourhood that no longer exists. Find each phrase and
replace it.

In `apps/desktop/src/decisions.test.ts`, the header names its companions. Grep for it first, because
the exact wording matters:

```bash
grep -n 'repository-wide' apps/desktop/src/decisions.test.ts packages/trace/src/*.test.ts
```

Then, in each of the three files, replace the sentence that counts these checks with one that is
true after the move. In `packages/trace/src/requirements.test.ts` and
`packages/trace/src/design.test.ts`, the phrases "Second of the repository-wide checks living in this
package alongside `version.test.ts` and `decisions.test.ts`. At three or four they want a workspace of
their own rather than a corner of the desktop app." and "Third of the repository-wide checks in this
package. At four they want a workspace of their own." both become:

```
 * One of the two checks over the requirement corpus, which now has the workspace those comments in
 * `apps/desktop` kept asking for. `version.test.ts`, `decisions.test.ts` and `icons.test.ts` stay
 * there: they do not parse requirements.
```

In `apps/desktop/src/decisions.test.ts`, whatever sentence positions it among the repository-wide
checks must stop implying that the requirement checks are its neighbours. If it names no neighbours,
leave it alone and say so in the commit.

- [ ] **Step 6: Run both suites and watch them pass**

```bash
pnpm --filter @alloy-works/trace test
pnpm --filter @alloy-works/desktop test
```

Expected: trace passes with every suite; desktop passes with four files rather than six, and no
reduction in what is asserted about requirements, because those assertions moved rather than went.

- [ ] **Step 7: Confirm nothing was silently lost**

```bash
git show HEAD --stat
pnpm test
```

Then count the assertions deliberately. Vitest reported **25 and 7** for these two files before the
move. Four `it()` calls go from `describe('the requirement identifiers')`, and one goes from
`describe('the numbered non-requirements and open questions')` - but that block runs inside a `for`
loop over both identifier kinds, so that single `it()` is **two** runtime tests. One test is added.

    25 - 4 - 2 + 1 = 20

So expect **20 and 7**. If the numbers differ, find out why before committing: the arithmetic is here
precisely so that a test lost by accident cannot hide behind a test deleted on purpose.

- [ ] **Step 8: Typecheck, lint and commit**

```bash
pnpm --filter @alloy-works/trace typecheck
pnpm --filter @alloy-works/desktop typecheck
pnpm lint
pnpm exec prettier --write packages/trace apps/desktop
git add packages/trace apps/desktop
git commit -m "Give the repository-wide requirement checks the workspace they asked for"
```

---

## Task 7: The documentation, the version and the changelog

**Files:**

- Modify: `docs/architecture.md` (the workspace table and the count above it)
- Modify: `docs/plans/README.md` (a section and a row for this plan)
- Modify: `CLAUDE.md` (the component table and the commands)
- Modify: `CHANGELOG.md`
- Modify: `version.json`, `package.json`, `apps/desktop/package.json`

- [ ] **Step 1: Update `docs/architecture.md`**

The sentence above the workspace table reads "One pnpm workspace, one lock file, ten packages."
Change `ten` to `eleven`. Add a row to the table, after the `packages/api-client` row:

```markdown
| `packages/trace` | `@alloy-works/trace` | The requirement corpus compiled: the parsers, the state ladder, the committed `trace.json`, and the query command |
```

- [ ] **Step 2: Update `CLAUDE.md`**

Add a row to the component table in the Architecture section, after the API client row:

```markdown
| Traceability | TypeScript - the requirement corpus parsed, compiled and queried | `packages/trace` |
```

And add to the Commands block, after the `api-client generate` line:

```bash
pnpm --filter @alloy-works/trace generate         # rewrite trace.json after changing a requirement or a design
pnpm trace stats                                  # the corpus by tranche and state; `pnpm trace` for the rest
```

- [ ] **Step 3: Mark this plan built in `docs/plans/README.md`**

The Traceability section and this plan's row already exist, added in the commit that added the plan.
Change its `Status` cell from `Planned` to `Built (PR #NN)`, with the number from Step 7.

- [ ] **Step 4: Bump the version in all three mirrors**

A functional enhancement: Minor up one, Build to zero. `0.10.16` becomes `0.11.0`.

```bash
sed -i 's/"version": "0.10.16"/"version": "0.11.0"/' version.json
sed -i '0,/"version": "0.10.16"/s//"version": "0.11.0"/' package.json
sed -i '0,/"version": "0.10.16"/s//"version": "0.11.0"/' apps/desktop/package.json
```

- [ ] **Step 5: Write the changelog entry**

Add at the top of `CHANGELOG.md`, above the `0.10.16` entry. Plain hyphens only, and written for
somebody who wants to know what changed for them.

Two values cannot be known until this work is pushed: replace `YYYY-MM-DD` with the date the entry is
written, and `#NN` with the number `gh pr create` returns in Step 7. Everything else below is final
text, not a sketch.

```markdown
## 0.11.0 - YYYY-MM-DD (PR #NN)

### Added

- `packages/trace` compiles the requirement corpus. 1,303 requirements across twenty-one areas, the
  112 non-requirements and the 131 open questions beside them, and every requirement a design claims,
  are parsed into one `trace.json` that is committed and checked against a fresh compile, in the same
  way `openapi.json` already is. A requirement now has a state computed from what cites it -
  `Specified`, `Designed`, or off the ladder entirely as `Withdrawn` or `Superseded` - rather than
  from a column somebody maintains.
- `pnpm trace` answers the question the corpus was too large to answer: `show CNT-014` for one
  requirement with its tranche, its state and the design that claims it; `search footnote` across
  every statement; `area VER` for a whole area; `next CNT` for the next free identifier; and `stats`
  for the shape of the whole.

### Changed

- The two repository-wide checks over the requirements move from `apps/desktop` into
  `packages/trace`, which is the workspace both files' own comments asked for once there were three or
  four of them. Nothing they asserted is lost: the identifier shapes, the tranche vocabulary and the
  status vocabulary are now refused by the parser at the document and line holding the offending row,
  which is a better failure than a test naming a value, and five tests that could no longer fail were
  deleted rather than left as decoration.
```

- [ ] **Step 6: Verify everything, then commit**

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
```

Expected: all pass, including `version.test.ts`, which checks the three mirrors against each other
and the newest changelog entry against `version.json`.

```bash
git add -A
git commit -m "Record the traceability layer in the docs, and bump for it"
```

- [ ] **Step 7: Push and open the pull request**

```bash
git push -u origin claude/traceability-01-the-compiled-corpus
```

Open the pull request with `gh pr create`, then put the real number into the changelog entry and into
the `docs/plans/README.md` row, and commit that. No closing keyword: this is a feature, and
`CLAUDE.md` scopes the issue-first rule to fixes.

---

## What this plan deliberately leaves undone

- **`IAM-018` is still claimed by no design.** Stage 1 does not read citations, so it cannot enforce
  the rule that would catch it; `pnpm trace show IAM-018` reports it, and the check arrives in stage 2. Fixing it means deciding which design owns it, which is a design conversation and not this
  plan's business.
- **`Covered` and `Verified` do not exist yet**, nor does the citation scanner, nor the Vitest
  reporter. Stage 2.
- **No baseline, no gate, no evidence pack.** Stage 3. Until then nothing fails because a requirement
  is undesigned, which is correct: a gate over 1,303 requirements with 175 designed would only ever
  be switched off.
- **No intake.** Stage 4. `pnpm trace next CNT` is the half of it that stage 1 can offer.
