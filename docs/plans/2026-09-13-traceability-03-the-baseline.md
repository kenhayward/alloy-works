# Traceability 3: the baseline and the evidence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an incomplete corpus defensible. Declare which requirements a release is answerable
for, gate on them in CI, and emit an evidence pack an auditor can read from a release tag.

**Architecture:** A baseline is a markdown document, parsed by the table reader `packages/trace`
already has. It names the requirements in force for a release, the exclusions with their reasons, and
how each requirement is verified. `gate.ts` decides pass or fail over that set and nothing else, so it
can be a real CI check on the day it lands. `pack.ts` writes the trace matrix, the gap report, the
model and the raw results into one directory named for a version.

**Tech Stack:** TypeScript, zod 4, Vitest 5, tsx. **No new dependency** - see decision 1 below.

**Spec:** [`../superpowers/specs/2026-09-13-requirements-traceability-design.md`](../superpowers/specs/2026-09-13-requirements-traceability-design.md)

Stage 3 of four. Stage 1 shipped in PR #61, stage 2 in PR #63, both on `main` at `0.12.0`.

## Four decisions taken before this plan was written

Each is a deviation from the design document, and each is justified below rather than assumed.

**1. The baseline is a markdown document, not YAML.** The design document's §7 shows
`baselines/<name>.yaml`. There is no YAML parser anywhere in this repository's dependency tree, so
YAML means a new runtime dependency in a product whose whole point is auditability - and a dependency
is a supply-chain item that has to be justified. Markdown needs none: `parse/table.ts` already reads a
table row, every other document in this corpus is markdown, and a markdown table is reviewable as a
diff in exactly the way `CLAUDE.md` asks of a requirement. So:
`docs/specification/baselines/<name>.md`.

**2. The first baseline declares what the release implements - 10 requirements, not T1.** The design
document says "T1 plus the Constraints in force". Measured against the corpus that does not survive
contact: T1 has **310** requirements in force, **61** of which a design claims and **7** of which a
test names. A T1 baseline would fail its own gate on 303 of 310, and the only way to make it pass
would be 303 exclusions each saying "not built yet", which is noise rather than evidence. A release
claims what it implements; this release implements the scaffolding. The baseline is small **because
the product is early**, which is a true statement rather than an embarrassing one.

**3. `IAM-018` is excluded, with that as its reason.** Of the eleven requirements a test names, ten
have a design and a title citation and so can be traced end to end. `IAM-018` cannot: it is named only
by a `rule:` field, which stage 2 established reaches `Covered` but never `Verified`, **and** no
design claims it. It is excluded, with both facts as the reason. That is what the exclusion mechanism
is for, and it gives it a real first user rather than a contrived one.

**4. The gate is CI's first check that is not `continue-on-error`.** Every check in
`.github/workflows/ci.yml` after Install carries `continue-on-error: true`, under a comment saying it
is temporary "while the repo is finding its baseline". `CLAUDE.md` forbids adding new
`continue-on-error` steps. Since the baseline is declared as what the release actually implements, the
gate passes on the day it lands, so it can be a real gate immediately. This does not begin the
switch-over described in `docs/ci-and-releases.md` and must not pretend to.

## Global Constraints

- **Test first, always.** Write the failing test, run it, watch it fail, then the minimal code to
  pass. Report the verbatim red output.
- **A passing run has no errors or warnings.** `consoleGate` throws from `console.error` and
  `console.warn`. Everything the CLI prints goes to stdout.
- **No new dependency.** If a task seems to need one, stop and report it.
- **Parsers take text, never a path.** `compile.ts` is the only module that reads the corpus;
  `cli.ts` is the only module that reads the results directory.
- **The baseline is hand-written and committed.** It is not generated, and no command may rewrite it -
  a baseline a tool can edit is not a declaration.
- **Every exclusion carries a reason, and its absence is an error**, not a warning. An exclusion
  without a reason is how a requirement gets quietly dropped.
- **The evidence pack is a point-in-time artifact.** It is committed, and it is **never**
  drift-checked - it records a run, so regenerating it later will legitimately differ.
- **Strict TypeScript:** `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`. `.js` extensions on imports.
- **No em or en dashes in the changelog.** Plain hyphen.
- **Version bump for the whole plan:** Minor, `0.12.0` to `0.13.0`. One bump, one changelog entry, in
  Task 6.
- **Corpus facts, all measured at `fad18dd`:** 1,303 requirements of which **1,264 are in force** (39
  superseded, none withdrawn); 175 claimed by a design, 169 of those in force; 15 citations naming 11
  requirements; `pnpm trace check` reports **7 problems**. The eleven cited: `IAM-004`, `IAM-018`,
  `IAM-043`, `IAM-054`, `STY-009`, `STY-027`, `STY-037`, `STY-038`, `STY-050`, `STY-051`, `STY-052`.
  Only `IAM-018` lacks a design, and only `IAM-018` is cited solely by a `rule:` field.
- **`packages/trace` has 136 tests across 11 files** before this plan.
- **Blank line before every `Co-Authored-By:` trailer**; verify each with `git log -1 --format='%s'`.

---

## File structure

| File                                     | Responsibility                                               |
| ---------------------------------------- | ------------------------------------------------------------ |
| `packages/trace/src/parse/baseline.ts`   | A baseline document's text to a declaration                  |
| `packages/trace/src/model.ts`            | Gains the `Baseline`, `Exclusion` and `Verification` schemas |
| `packages/trace/src/gate.ts`             | Pass or fail over a baseline, and why                        |
| `packages/trace/src/pack.ts`             | The evidence pack's documents, as strings                    |
| `packages/trace/src/cli.ts`              | Gains `baseline`, `gate`, `pack`                             |
| `docs/specification/baselines/README.md` | What a baseline is and how one is written                    |
| `docs/specification/baselines/0.13.0.md` | The first baseline                                           |
| `.github/workflows/ci.yml`               | The gate step, not `continue-on-error`                       |
| `docs/trace/0.13.0/`                     | The first evidence pack, generated and committed             |

---

## Task 1: The baseline document, and its parser

**Files:**

- Create: `docs/specification/baselines/README.md`
- Modify: `packages/trace/src/model.ts`
- Create: `packages/trace/src/parse/baseline.ts`
- Test: `packages/trace/src/parse/baseline.test.ts`

**Interfaces:**

- Consumes: `tableCells`, `boldIdentifier` from `./table.js`; `REQUIREMENT_ID`, `validate` from
  `../model.js`.
- Produces: the schemas and types `Inclusion`, `Exclusion`, `Verification`, `Baseline`, and the
  constant `VERIFICATION_KINDS`; `parseBaseline(document: string, text: string): Baseline`.

**The document format.** Three sections, each a markdown table, so that the whole thing is one
reviewable diff. Write `docs/specification/baselines/README.md` first, because the format is the
deliverable and the parser follows it:

```markdown
# <version>

> **Declared:** YYYY-MM-DD. What this release is answerable for.

## Included

| ID          | Why it is in force                   |
| ----------- | ------------------------------------ |
| **IAM-004** | Enforced by the environment boundary |

## Excluded

| ID          | Reason                                 |
| ----------- | -------------------------------------- |
| **IAM-018** | Cited only by a `rule:` field, and ... |

## Verification

| ID          | Kind        | By                          |
| ----------- | ----------- | --------------------------- |
| **ADM-031** | attestation | Ken Hayward, 2026-09-13 ... |
```

A requirement absent from all three tables is simply out of baseline and needs no entry - only an
**exclusion** needs a reason, and an exclusion is for a requirement somebody might expect to be in.
A requirement with no `Verification` row is verified by `test`, the default.

- [ ] **Step 1: Write `docs/specification/baselines/README.md`**

Explain: what a baseline is (the set a release is answerable for); that it is hand-written and no
command may rewrite it; the three tables and what each means; that every exclusion needs a reason and
its absence is an error; the three verification kinds and that `test` is the default needing no row;
and that a requirement absent from every table is out of baseline, which is different from excluded.
Link it from `docs/specification/requirements/README.md`.

- [ ] **Step 2: Write the failing parser test**

`packages/trace/src/parse/baseline.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { parseBaseline } from './baseline.js';

const document = '0.0.0-invented.md';

const doc = (...sections: string[]): string =>
  ['# 0.0.0-invented', '', '> **Declared:** 2026-09-13. For testing.', '', ...sections].join('\n');

const included = [
  '## Included',
  '',
  '| ID          | Why it is in force |',
  '| ----------- | ------------------ |',
  '| **ZZZ-001** | Because it is      |',
  '',
];

describe('parsing a baseline document', () => {
  it('reads the version and the declaration date from the heading and the banner', () => {
    const parsed = parseBaseline(document, doc(...included));

    expect(parsed.name).toBe('0.0.0-invented');
    expect(parsed.declaredAt).toBe('2026-09-13');
  });

  it('reads the included requirements', () => {
    expect(parseBaseline(document, doc(...included)).included).toEqual([
      { id: 'ZZZ-001', why: 'Because it is' },
    ]);
  });

  it('reads an exclusion with its reason', () => {
    const parsed = parseBaseline(
      document,
      doc(
        ...included,
        '## Excluded',
        '',
        '| ID          | Reason        |',
        '| ----------- | ------------- |',
        '| **ZZZ-002** | Not built yet |',
      ),
    );

    expect(parsed.excluded).toEqual([{ id: 'ZZZ-002', reason: 'Not built yet' }]);
  });

  // The one thing the design document insists on: an exclusion without a reason is how a requirement
  // gets quietly dropped, so it is an error rather than a warning.
  it('refuses an exclusion with no reason, naming the document and line', () => {
    const text = doc(
      ...included,
      '## Excluded',
      '',
      '| ID          | Reason |',
      '| ----------- | ------ |',
      '| **ZZZ-002** |        |',
    );

    expect(() => parseBaseline(document, text)).toThrow(/0\.0\.0-invented\.md:\d+/);
  });

  it('reads a verification kind and what it rests on', () => {
    const parsed = parseBaseline(
      document,
      doc(
        ...included,
        '## Verification',
        '',
        '| ID          | Kind        | By                      |',
        '| ----------- | ----------- | ----------------------- |',
        '| **ZZZ-001** | attestation | Ada Lovelace, 2026-09-13 |',
      ),
    );

    expect(parsed.verification).toEqual([
      { id: 'ZZZ-001', kind: 'attestation', by: 'Ada Lovelace, 2026-09-13' },
    ]);
  });

  it('refuses a verification kind it does not know', () => {
    const text = doc(
      ...included,
      '## Verification',
      '',
      '| ID          | Kind    | By  |',
      '| ----------- | ------- | --- |',
      '| **ZZZ-001** | vibes   | Ada |',
    );

    expect(() => parseBaseline(document, text)).toThrow(/vibes|kind/i);
  });

  it('refuses a verification row whose By cell is empty, whatever the kind', () => {
    const text = doc(
      ...included,
      '## Verification',
      '',
      '| ID          | Kind      | By  |',
      '| ----------- | --------- | --- |',
      '| **ZZZ-001** | inherited |     |',
    );

    expect(() => parseBaseline(document, text)).toThrow(/0\.0\.0-invented\.md:\d+/);
  });

  it('treats the three sections as independent, so a baseline may exclude nothing', () => {
    const parsed = parseBaseline(document, doc(...included));

    expect(parsed.excluded).toEqual([]);
    expect(parsed.verification).toEqual([]);
  });

  it('refuses a baseline that includes nothing, which is not a declaration', () => {
    expect(() =>
      parseBaseline(document, doc('## Included', '', '| ID | Why |', '| -- | --- |')),
    ).toThrow(/includes nothing/i);
  });

  it('stops each section at the next heading, so a table below one is not read into it', () => {
    const parsed = parseBaseline(
      document,
      doc(
        ...included,
        '## Notes',
        '',
        '| ID          | Something |',
        '| ----------- | --------- |',
        '| **ZZZ-009** | Not a row |',
      ),
    );

    expect(parsed.included).toEqual([{ id: 'ZZZ-001', why: 'Because it is' }]);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
pnpm --filter @alloy-works/trace test baseline
```

Expected: FAIL, cannot resolve `./baseline.js`.

- [ ] **Step 4: Add the schemas to `model.ts`**

```ts
/** Why a requirement somebody might expect in the baseline is not in it. A reason is mandatory. */
export const Exclusion = z.object({
  id: z.string().regex(REQUIREMENT_ID),
  reason: z.string().min(1),
});
export type Exclusion = z.infer<typeof Exclusion>;

export const VERIFICATION_KINDS = ['test', 'inherited', 'attestation'] as const;

/**
 * How a requirement is shown to be met. `test` is the default and needs no declaration: a test names
 * it and passes. The other two exist because a constraint that governs how everything is built often
 * cannot be reached by a test named after it, and pretending otherwise is how a traceability matrix
 * becomes a lie that passes.
 */
export const Verification = z.object({
  id: z.string().regex(REQUIREMENT_ID),
  kind: z.enum(VERIFICATION_KINDS),
  by: z.string().min(1),
});
export type Verification = z.infer<typeof Verification>;

export const Inclusion = z.object({
  id: z.string().regex(REQUIREMENT_ID),
  why: z.string().min(1),
});
export type Inclusion = z.infer<typeof Inclusion>;

/**
 * The set of requirements a release is answerable for.
 *
 * Hand-written and committed. No command may rewrite it: a baseline a tool can edit is not a
 * declaration, and the whole value of one is that a person put their name to it.
 */
export const Baseline = z.object({
  name: z.string().min(1),
  declaredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  included: z.array(Inclusion).min(1),
  excluded: z.array(Exclusion),
  verification: z.array(Verification),
});
export type Baseline = z.infer<typeof Baseline>;
```

**Note the name clash:** `results.ts` already exports an interface called `Verification`. Rename the
one in `results.ts` to `TestOutcome` as part of this step, updating `state.ts`, `format.ts`, `cli.ts`
and their tests. Two different things called `Verification` in one package is exactly the seam a
reviewer would flag, and the baseline's is the one that deserves the name.

- [ ] **Step 5: Write the parser**

`packages/trace/src/parse/baseline.ts`. Reuse `tableCells` and `boldIdentifier`; take the section
boundaries the same way `parse/design.ts` does. The heading gives the name; the banner gives the date.
Validate every row through `validate(...)` with a `${document}:${line}` prefix, so a malformed
baseline fails the way a malformed requirement does.

- [ ] **Step 6: Run it and watch it pass**

Expected: PASS, 10 tests.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
pnpm --filter @alloy-works/trace typecheck
pnpm lint
pnpm exec prettier --write packages/trace docs/specification/baselines
git add packages/trace docs/specification
git commit -m "Read a baseline, and make an exclusion without a reason an error"
```

---

## Task 2: What the baseline demands, and whether it is met

**Files:**

- Create: `packages/trace/src/gate.ts`
- Test: `packages/trace/src/gate.test.ts`

**Interfaces:**

- Produces: `type Unmet = { id: string; kind: (typeof VERIFICATION_KINDS)[number]; why: string }`;
  `interface GateResult { baseline: string; declaredAt: string; total: number; met: number; unmet: Unmet[]; problems: Problem[] }`;
  `gate(baseline: Baseline, model: TraceModel, outcomes: Map<string, TestOutcome>): GateResult`.

**What the gate decides**, and nothing more - a gate that also has opinions is a gate somebody
switches off:

1. Every **included** requirement must exist in the corpus, and must be in force. An included
   requirement that is `Withdrawn` or `Superseded` is `unmet`, because a release cannot be answerable
   for something no longer in force.
2. Every included requirement must be **met according to its declared kind**:
   - `test` (the default): a citation names it **and** every test naming it passed.
   - `inherited`: the identifier in `by` must exist, be in the baseline, and itself be met.
   - `attestation`: the `by` text is the evidence. It is accepted as met, and **recorded in the
     result** so the pack can print who attested to what.
3. Every **excluded** requirement must exist, and must have a reason. A reason is already mandatory at
   parse time; the gate additionally refuses an exclusion for a requirement that is **also included**.
4. Every **verification** row must name an included requirement. A declaration about a requirement
   outside the baseline is a mistake worth catching.
5. The corpus's own `problems(model)` are carried in the result but **do not fail the gate**, except
   where a problem touches the baseline. A stale design claim on a requirement nobody has declared is
   not this release's problem. Two cases decide what "touches" means, and both matter:
   - A problem whose `id` is an **included requirement** fails the gate.
   - A `not-contiguous` problem's `id` is an **area code, not a requirement** - `problems()` reports it
     per area. It fails the gate when that area contains **any** included requirement. Without this
     rule a hole in `IAM` would pass a baseline containing three `IAM` requirements, which is precisely
     the deletion-disguised-as-an-edit the contiguity check exists to catch.

Point 5 is the one to get right. The corpus has 7 problems today, none about the ten in the first
baseline and none a contiguity hole, so the gate passes while `pnpm trace check` still reports all
seven. Those are different questions and must stay different. **Write the area-code case as its own
test**, because the obvious implementation - matching a problem's `id` against the included set -
silently gets it wrong.

- [ ] **Step 1: Write the failing test**

Cover each rule with an invented `ZZZ-` fixture, one test per rule, plus:

```ts
it('fails an included requirement that no test names', () => {
  /* unmet, kind test */
});
it('fails an included requirement whose test failed', () => {
  /* unmet */
});
it('fails an included requirement that is superseded, since a release cannot answer for it', () => {});
it('meets an inherited requirement when what it rests on is met', () => {});
it('fails an inherited requirement when what it rests on is not met', () => {});
it('fails an inherited requirement whose target is outside the baseline', () => {});
it('meets an attested requirement, and records who attested', () => {});
it('fails a requirement both included and excluded', () => {});
it('fails a verification row naming a requirement outside the baseline', () => {});
it('carries the corpus problems without failing on one outside the baseline', () => {});
it('fails on a corpus problem about a baseline requirement', () => {});
```

**Write these first and watch them fail.** Then, for the inherited chain, add one more that would be
easy to get wrong:

```ts
// An inherited chain must not be able to verify itself.
it('fails a pair of requirements that inherit from each other', () => {
  // ZZZ-001 inherited by ZZZ-002, ZZZ-002 inherited by ZZZ-001, neither cited
  // Expect both unmet, and expect the call to terminate rather than recurse for ever.
});
```

- [ ] **Step 2: Run, watch fail, implement `gate.ts`, run again**

Resolve `inherited` iteratively rather than recursively, so a cycle terminates: repeatedly mark
newly-met requirements until nothing changes, then whatever is left unmet is unmet. Say so in a
comment, because the obvious recursive implementation stack-overflows on the cycle the test pins.

- [ ] **Step 3: Commit**

```bash
git commit -m "Decide a baseline, and let a cycle of inheritance fail rather than recurse"
```

---

## Task 3: Declare the first baseline

**Files:**

- Create: `docs/specification/baselines/0.13.0.md`
- Modify: `packages/trace/src/cli.ts` (the `baseline` command)
- Test: `packages/trace/src/baseline.test.ts` (the real baseline, asserted)

**The content.** Ten included, one excluded, no verification rows - every one of the ten is verified
by a test that names it, which is the default kind.

Included, with the design that claims each as the "why":

| ID          | Design                   |
| ----------- | ------------------------ |
| **IAM-004** | `service-foundations.md` |
| **IAM-043** | `service-foundations.md` |
| **IAM-054** | `service-foundations.md` |
| **STY-009** | `themes.md`              |
| **STY-027** | `themes.md`              |
| **STY-037** | `themes.md`              |
| **STY-038** | `themes.md`              |
| **STY-050** | `themes.md`              |
| **STY-051** | `themes.md`              |
| **STY-052** | `themes.md`              |

Write a real "why it is in force" for each - read the requirement and the design's `How it is met`
cell and say in one clause what makes it answerable for now. **Do not write "it is tested"**; that is
the gate's job to establish, not the baseline's job to assert.

Excluded, one row, and the reason is the honest one:

| ID          | Reason                                                                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IAM-018** | Named only by a `rule:` field, which establishes `Covered` but never `Verified`, and claimed by no design. It cannot be traced end to end, so this release does not claim it. |

- [ ] **Step 1: Write the baseline document**

- [ ] **Step 2: Add `pnpm trace baseline [name]`**

Prints the baseline: its name, date, how many are included, the exclusions with their reasons, and any
verification declarations. It **reads and reports only** - it never writes the document. Default to
the newest baseline by filename if no name is given.

- [ ] **Step 3: Write a test over the real baseline**

`packages/trace/src/baseline.test.ts`, which reads the actual document from disk and asserts the
things a person would otherwise have to remember:

```ts
it('includes only requirements that exist and are in force', () => {});
it('gives every exclusion a reason', () => {});
it('excludes nothing it also includes', () => {});
it('names IAM-018 as excluded, with the rule-field ceiling as the reason', () => {});
it('declares ten included requirements', () => {});
```

The last is a canary, like the corpus counts: it fails when the baseline changes, which is a change
that should never be silent.

- [ ] **Step 4: Run `pnpm trace baseline` and put its output in the report. Commit.**

---

## Task 4: The gate, in CI

**Files:**

- Modify: `packages/trace/src/cli.ts` (the `gate` command)
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/ci-and-releases.md`

- [ ] **Step 1: Add `pnpm trace gate [name]`**

Reads the baseline, the model and the results directory, runs `gate(...)`, prints the outcome, and
**exits 0 or 1**. The output must say, in this order: the baseline and its date; how many included
requirements are met out of how many; then one line per unmet requirement saying which rule it broke;
then a count of corpus problems outside the baseline, as information rather than failure.

It must fail legibly - not with a stack trace - when the baseline does not exist, and when the results
directory is missing or incoherent, reusing stage 2's coherence check.

- [ ] **Step 2: Prove it both ways, on real data**

```bash
pnpm test && pnpm trace gate
```

Expected: passes, 10 of 10 met, exit 0, and a line noting 7 corpus problems outside the baseline.

Then prove it fails: temporarily add `| **CNT-001** | Invented |` to the baseline's Included table,
re-run, and confirm it reports `CNT-001` unmet with the reason that no test names it, and exits 1.
**Restore the document** and confirm the gate passes again. Both outputs go in your report.

- [ ] **Step 3: Add the CI step**

In `.github/workflows/ci.yml`, after the `Test` step, add:

```yaml
# NOT continue-on-error. The baseline declares what this release is answerable for, so the gate
# passes on the day it lands - and a traceability gate that is allowed to fail is not a gate.
# This is deliberately narrow: it says nothing about the checks above it, and does not begin the
# switch-over in docs/ci-and-releases.md.
- name: Traceability gate
  run: pnpm trace gate
```

It must come after `Test`, because the gate reads the JSON reports that step writes.

- [ ] **Step 4: Say so in `docs/ci-and-releases.md`**

Add a paragraph: the traceability gate is the first check in CI that is not `continue-on-error`, why
that is safe (the baseline declares what is implemented), and that it is not the beginning of the
switch-over - which still has its own checklist ending in branch protection.

- [ ] **Step 5: Commit**

---

## Task 5: The evidence pack

**Files:**

- Create: `packages/trace/src/pack.ts`
- Test: `packages/trace/src/pack.test.ts`
- Modify: `packages/trace/src/cli.ts` (the `pack` command)
- Modify: `.prettierignore`
- Create: `docs/trace/0.13.0/` (generated, committed)

**Interfaces:**

- Produces: `packDocuments(input): { path: string; body: string }[]` - pure, returning the pack's
  documents as strings so every one of them is testable without a filesystem.

**What the pack contains.** Four documents, each a thing an auditor asks for:

| File         | Contents                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `README.md`  | The version, the commit, the date, the baseline, the gate's verdict, and what each file below is |
| `matrix.md`  | One row per **baseline** requirement: identifier, statement, tranche, design, tests, verdict     |
| `gaps.md`    | Every corpus problem, and every in-force requirement outside the baseline, counted by tranche    |
| `results.md` | Which tests were run, from the JSON reports, and their outcome                                   |

The commit and the version come **in** as arguments; `pack.ts` must not read git or the filesystem, so
its tests are strings. `cli.ts` supplies them.

- [ ] **Step 1: Write the failing test**

Assert the shape rather than the prose: four documents at the expected paths; `matrix.md` has exactly
one row per baseline requirement and none for anything outside it; `gaps.md` names every problem;
`README.md` carries the commit and the verdict; and - the property worth pinning - **no document
contains a requirement's statement for a requirement outside the baseline**, because the pack is
evidence about a declared scope and must not silently widen it.

- [ ] **Step 2: Run, watch fail, implement, run again**

- [ ] **Step 3: Add `pnpm trace pack <version>`**

Writes into `docs/trace/<version>/`. It takes the commit from `git rev-parse HEAD` in `cli.ts`, and
**refuses to run when the gate fails** - an evidence pack for a release that does not meet its own
baseline is worse than none, because it looks like evidence.

- [ ] **Step 4: Keep Prettier off it, and never drift-check it**

Add `docs/trace/` to `.prettierignore` with a comment saying why: it is generated, and it records a
run rather than the documents, so it must never be compared against a fresh generation the way
`trace.json` is.

- [ ] **Step 5: Generate the first pack and commit it**

```bash
pnpm test && pnpm trace gate && pnpm trace pack 0.13.0
```

Then read `docs/trace/0.13.0/README.md` and `matrix.md` yourself and check they are documents a person
would accept as evidence. **Put the full text of `README.md` and the first few rows of `matrix.md` in
your report** - if the pack is not legible, that is the finding, and no test will tell you.

- [ ] **Step 6: Commit**

---

## Task 6: The paperwork

**Files:** `docs/architecture.md`, `CLAUDE.md`, `docs/testing.md`,
`docs/specification/requirements/README.md`, `docs/plans/README.md`, `CHANGELOG.md`, `version.json`,
`package.json`, `apps/desktop/package.json`

- [ ] **Step 1: Documentation**

- `docs/architecture.md`: the `packages/trace` row gains the baseline, the gate and the pack; mention
  that CI now has one real gate.
- `CLAUDE.md`: add `pnpm trace gate` and `pnpm trace pack` to the commands, and one line in the CI
  section that the traceability gate is not `continue-on-error` and why.
- `docs/testing.md`: how the gate uses the JSON reports.
- `docs/specification/requirements/README.md`: link the baselines folder and say what a baseline does
  for a requirement that is not in one.
- `docs/plans/README.md`: the stage 3 row, `Built (PR #NN)`.

- [ ] **Step 2: Version** `0.12.0` to `0.13.0` in all three mirrors.

- [ ] **Step 3: Changelog.** Plain hyphens. Cover: the baseline and what the first one declares; that
      the gate is CI's first real check; the evidence pack; and - stated plainly - that the corpus has
      seven known problems which the gate deliberately does not fail on, because they are outside the
      declared scope. Leave `#NN` literal.

- [ ] **Step 4:** `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm trace gate`. All
      five must pass. **Do not push and do not open a pull request.**

---

## Expected test counts, so a lost test cannot hide

`packages/trace` has **136 tests across 11 files** before this plan. Expect, per new or changed file:

| File                     | Tests | Source                                                      |
| ------------------------ | ----- | ----------------------------------------------------------- |
| `parse/baseline.test.ts` | 10    | Task 1 Step 2                                               |
| `gate.test.ts`           | 13    | Task 2 Step 1 - eleven named, the cycle test, the area case |
| `baseline.test.ts`       | 5     | Task 3 Step 3, over the real document                       |
| `pack.test.ts`           | 5     | Task 5 Step 1                                               |

That totals **169 across 15 files**. Task 1 Step 4's rename of `results.ts`'s `Verification` to
`TestOutcome` touches `state.ts`, `format.ts`, `cli.ts` and three test files but must **not** change any
count - if it does, a test was lost in the rename, which is the one thing that rename could plausibly
break.

## What this plan deliberately leaves undone

- **No intake.** Stage 4: the GitHub issue form and `trace draft`.
- **The seven corpus problems are not fixed.** Six designs claim a superseded requirement whose
  replacement nobody claims, and `IAM-018` is cited by a test and claimed by nothing. Which design
  claims what is a design conversation, and the baseline's job is to say the release does not claim
  them - not to hide them.
- **`inherited` and `attestation` have no user in the first baseline.** Every one of the ten is
  verified by a test. Both kinds are built anyway, and exercised by tests rather than by the corpus,
  because the baseline is a **document format** and a format that cannot express an attestation would
  have to change the first time a constraint no test can reach enters a baseline. That is a deliberate
  exception to YAGNI, and this is it being declared rather than smuggled.
- **No release workflow.** `pack` is run by hand; nothing ties it to a tag yet.
- **The gate says nothing about the checks above it in CI.** Lint, format, typecheck, build and test
  remain `continue-on-error` under their own temporary comment, and the switch-over keeps its own
  checklist in `docs/ci-and-releases.md`.
