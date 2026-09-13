# Traceability 4: intake

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a requirement arrive from a tester, a user or the author as a GitHub issue, and land as
a row somebody reviewed - with the issue as the change-control record an audit asks for.

**Architecture:** A GitHub issue form captures the fields. `parse/issue.ts` reads the rendered issue
body into those fields. `draft.ts` allocates the next free identifier and formats a table row. The CLI
prints it, with the candidate sections of the area document, for a person to place. Nothing writes to
the corpus.

**Tech Stack:** TypeScript, zod 4, Vitest 5, tsx. No new dependency.

**Spec:** [`../superpowers/specs/2026-09-13-requirements-traceability-design.md`](../superpowers/specs/2026-09-13-requirements-traceability-design.md)

Stage 4 of four, and the smallest. Stages 1, 2 and 3 shipped as PRs #61, #63 and #64, all on `main` at
`0.13.0`.

## Two decisions taken before this plan was written

**1. `draft` prints a row; it does not insert one.** The design's §9 says it "inserts the row in the
section named". It should not, and the reason is in
[`../specification/requirements/README.md`](../specification/requirements/README.md): _"A requirement
added later belongs beside the ones it relates to and keeps the next free number when it goes there."_
Which narrative section a requirement belongs beside is a judgement about meaning. A tool that guessed
would put a footnote requirement under tables, and the corpus would still parse, so nothing would
catch it. The issue form cannot sensibly ask a tester to name a section of a 500-line document either.

So `draft` does the parts a tool is better at - allocating an identifier that is never reused,
formatting a row that parses, carrying the issue number - and leaves the one judgement to a person. It
prints the candidate section headings to make that judgement quick. This also keeps every path that
mutates the corpus in human hands, which is the same principle that makes a baseline hand-written.

**2. The issue form asks how we would know the requirement is met.** The design's §9 lists area,
statement, reasoning, suggested tranche and who asked. Add one field: **how would we know this is
met?** Three stages of this work have established that a requirement's worth depends on something
being able to demonstrate it, and the cheapest moment to think about that is when the requirement is
written, not when somebody later tries to cite it from a test. The field is optional, because refusing
a requirement for want of it would lose the requirement.

## Global Constraints

- **Test first, always.** Write the failing test, run it, watch it fail, then the minimal code to
  pass. Report the verbatim red output.
- **A passing run has no errors or warnings.** Everything the CLI prints goes to stdout.
- **No new dependency.**
- **Nothing in this stage writes to the corpus.** Not a requirement document, not a baseline. If a
  task seems to need to, stop and report it.
- **Parsers take text, never a path.** `cli.ts` is the only module that may call `gh`.
- **An identifier is allocated once and never reused.** `nextIdentifier` in `format.ts` already takes
  the highest allocated plus one, never the count - do not reimplement it.
- **A statement must say `must` or `should`.** The parser refuses one that does not, at the document
  and line. `draft` must catch it at intake instead, where it can be fixed by asking.
- **No em or en dashes in the changelog**, and none in the issue form, which is user-facing text a
  tester reads. Plain hyphen.
- **Version bump for the whole plan:** Minor, `0.13.0` to `0.14.0`, in Task 5.
- **Corpus facts at `91f8b0d`:** 1,303 requirements, 21 areas, `pnpm trace next CNT` is `CNT-142`. The
  `0.13.0` baseline declares 7 and excludes 4. `packages/trace` has 224 tests across 17 files.
- **Strict TypeScript:** `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`. `.js` extensions on imports.
- **Blank line before every `Co-Authored-By:` trailer**; verify each with `git log -1 --format='%s'`.

---

## File structure

| File                                     | Responsibility                                            |
| ---------------------------------------- | --------------------------------------------------------- |
| `.github/ISSUE_TEMPLATE/requirement.yml` | The form a tester, a user or the author fills in          |
| `.github/ISSUE_TEMPLATE/config.yml`      | Keeps the blank-issue option, so nothing is forced        |
| `packages/trace/src/parse/issue.ts`      | A rendered issue body to its fields                       |
| `packages/trace/src/draft.ts`            | Allocate, format the row, and name the candidate sections |
| `packages/trace/src/cli.ts`              | Gains `draft`                                             |
| `packages/trace/src/intake.test.ts`      | The form's area list against the corpus                   |

---

## Task 1: The issue form, and a test that it cannot drift from the corpus

**Files:**

- Create: `.github/ISSUE_TEMPLATE/requirement.yml`
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Test: `packages/trace/src/intake.test.ts`

**The form's fields**, in this order, because it is the order somebody thinks in:

| Field             | Type     | Required | Notes                                                           |
| ----------------- | -------- | -------- | --------------------------------------------------------------- |
| Area              | dropdown | yes      | The 21 codes, each shown as `CNT - Content and authoring`       |
| The requirement   | textarea | yes      | One sentence saying what must be true. Placeholder shows `must` |
| Why               | textarea | yes      | What goes wrong without it                                      |
| How we would know | textarea | no       | What would demonstrate it. Decision 2 above                     |
| Suggested tranche | dropdown | no       | `T1`-`T6`, `Constraint`, or `Not sure`                          |
| Who asked         | input    | no       | A tester, a user, or the author. Not an email address           |

**Write the form's copy for the person filling it in, not for the tool.** A tester does not know what
a tranche is; the dropdown's description should say so in one clause. The `description` on the
requirement field should say plainly that it must contain the word `must` or `should`, because the
corpus refuses one that does not, and being told that here is better than being told later.

**Never ask for an identifier.** `draft` allocates it, and a human-chosen one would collide.

**`config.yml` must keep `blank_issues_enabled: true`.** A bug report is not a requirement, and a form
that is the only way in turns every observation into a requirement.

- [ ] **Step 1: Write the failing test**

`packages/trace/src/intake.test.ts`. It reads the form and the requirements index from disk and pins
the one thing that will otherwise drift - the area list:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './compile.js';

/**
 * The issue form's area dropdown is a copy of the corpus's area codes, and a copy drifts. An area
 * added to the corpus and not to the form is an area nobody can file against; one removed from the
 * corpus and left in the form invites a requirement in an area that does not exist.
 */
const form = readFileSync(join(REPO_ROOT, '.github', 'ISSUE_TEMPLATE', 'requirement.yml'), 'utf8');
const index = readFileSync(
  join(REPO_ROOT, 'docs', 'specification', 'requirements', 'README.md'),
  'utf8',
);

/** `| **CNT** | Content and authoring | 7.1 | [file](file) |` in the index. */
const areasInIndex = [...index.matchAll(/^\|\s*\*\*([A-Z]{3})\*\*\s*\|/gm)].map((m) => m[1]!);

/** `      - CNT - Content and authoring` in the dropdown's options. */
const areasInForm = [...form.matchAll(/^\s+- ([A-Z]{3}) - /gm)].map((m) => m[1]!);

describe('the requirement issue form', () => {
  it('offers every area the corpus defines, and no others', () => {
    expect(areasInForm.sort()).toEqual([...areasInIndex].sort());
  });

  it('offers all twenty-one, so neither list is empty by accident', () => {
    expect(areasInForm).toHaveLength(21);
  });

  // This checks the labels a person reads, not the YAML's own keys: a GitHub issue form gives every
  // field an `id:`, so a naive search for "id" would fail on a perfectly correct form.
  it('asks for no identifier, because draft allocates one that is never reused', () => {
    const labels = [...form.matchAll(/^\s+label:\s*(.+)$/gm)].map((m) => m[1]!);

    expect(labels.length).toBeGreaterThan(3);
    expect(labels.filter((label) => /identifier|\bid\b|CNT-\d/i.test(label))).toEqual([]);
  });

  it('keeps the blank issue option, so an observation need not become a requirement', () => {
    const config = readFileSync(join(REPO_ROOT, '.github', 'ISSUE_TEMPLATE', 'config.yml'), 'utf8');

    expect(config).toMatch(/blank_issues_enabled:\s*true/);
  });

  it('tells the person filling it in that a requirement says must or should', () => {
    expect(form).toMatch(/\bmust\b/);
    expect(form).toMatch(/\bshould\b/);
  });

  it('uses no em or en dash, because a tester reads this copy', () => {
    expect(form).not.toMatch(/[–—]/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @alloy-works/trace test intake
```

Expected: FAIL on the missing file.

- [ ] **Step 3: Write the two YAML files, then run it green**

Take the 21 codes and their names from `docs/specification/requirements/README.md`'s area table - read
them, do not retype them from memory. Expected: PASS, 6 tests.

- [ ] **Step 4: Commit**

```bash
pnpm exec prettier --write .github packages/trace
git add .github packages/trace
git commit -m "Ask for a requirement in a form, and pin its areas to the corpus"
```

---

## Task 2: Read a filed issue

**Files:**

- Create: `packages/trace/src/parse/issue.ts`
- Test: `packages/trace/src/parse/issue.test.ts`

**Interfaces:**

- Produces: the schema and type `FiledRequirement`;
  `parseIssue(body: string): FiledRequirement`.

**What a filed issue looks like.** GitHub renders an issue form as the field labels as level-three
headings with the answers beneath, and writes `_No response_` for an empty optional field. So a filed
issue's body is:

```markdown
### Area

CNT - Content and authoring

### The requirement

A footnote must be able to carry a citation.

### Why

Reviewers put sources in footnotes, and losing them makes the footnote useless.

### How we would know

A footnote containing a citation survives a Word round trip.

### Suggested tranche

T1

### Who asked

A reviewer on the pilot
```

- [ ] **Step 1: Write the failing test**

Cover: a complete issue; an issue where every optional field is `_No response_`; an area cell given as
`CNT - Content and authoring` yielding `CNT`; a multi-paragraph answer kept whole; a heading order
different from the form's, since GitHub preserves the form's order but a hand-edited issue may not; a
statement containing `must`; **a statement containing neither `must` nor `should`, which must throw**,
because catching that at intake is the whole point; a missing required heading, which must throw
naming which; and `Not sure` as a tranche yielding `undefined` rather than a bad value.

Write these bodies as template literals. Use invented content - an invented area is not possible here
since the area must be real, so use `CNT`, but invent the requirement text.

- [ ] **Step 2: Run it, watch it fail, then write the parser**

`parse/issue.ts` is pure and takes text. Split on `^### ` headings, trim each answer, treat
`_No response_` as absent, and take the area as the first three characters of its answer. Validate
through zod with a message that names the field, since the person reading the failure is the author
running `draft`, not a compiler.

`FiledRequirement` is `{ area, statement, why, howWeWouldKnow: string | undefined, tranche: string | undefined, whoAsked: string | undefined }`. Declare the
optional three as `string | undefined` and always present - an optional property is not assignable
under `exactOptionalPropertyTypes`.

- [ ] **Step 3: Commit**

---

## Task 3: Allocate, format, and name the candidates

**Files:**

- Create: `packages/trace/src/draft.ts`
- Test: `packages/trace/src/draft.test.ts`

**Interfaces:**

- Consumes: `nextIdentifier` from `./format.js`, `TraceModel` from `./model.js`, `FiledRequirement`.
- Produces: `interface Draft { id: string; row: string; sections: string[]; warnings: string[] }`;
  `draftRequirement(filed: FiledRequirement, model: TraceModel, areaDocumentText: string, issue: number): Draft`.
  The third argument is the area document's **text**, not its path - `draft.ts` is pure like every other
  module here, and `cli.ts` reads the file.

**What it returns, and why each part:**

- **`id`** - from `nextIdentifier`, which takes the highest allocated plus one. Never the count: a
  withdrawn row keeps its number, so counting would reissue a live identifier.
- **`row`** - a markdown table row that the requirement parser will accept:
  `| **CNT-142** | <statement> | T1 | Specified |`. The tranche defaults to a literal `T?` when the
  filer did not say, so the author must choose rather than the tool guessing. **A `T?` in a committed
  document is refused by the parser**, which is the point - it cannot be forgotten.
- **`sections`** - the level-two and level-three headings of the area document that already contain a
  requirements table, so the author can see where the new row might belong. This is the part that
  makes the judgement quick without making it for them.
- **`warnings`** - things worth saying out loud: that the statement says neither `must` nor `should`
  (though `parseIssue` refuses that earlier, so this is belt and braces for a hand-built
  `FiledRequirement`); that no tranche was given; that no test-hint was given. **A warning is never a
  refusal** - the requirement is more valuable than the metadata.

- [ ] **Step 1: Write the failing test**

Cover each of the four outputs. For `sections`, use a small invented area document with two sections
containing requirement tables and one containing none, and assert only the two are offered. For the
row, assert it parses: **feed the produced row to `parseAreaDocument` and assert the requirement comes
back**, which is a far better test than comparing strings, because it pins the one property that
matters. Use a tranche the filer gave, and separately assert the `T?` placeholder appears when they
did not.

- [ ] **Step 2: Run, watch fail, implement, run green**

- [ ] **Step 3: Commit**

---

## Task 4: `pnpm trace draft`

**Files:**

- Modify: `packages/trace/src/cli.ts`
- Modify: `packages/trace/src/format.ts` (the draft's output) and its test

**Two ways in**, because `gh` may not be installed or authenticated and the command must still be
useful:

```
  draft <issue>                     read GitHub issue <issue> and draft a row from it
  draft --area CNT --statement "..." [--tranche T1] [--issue 42]
                                    draft a row from the command line
```

The first shells out to `gh issue view <n> --json body --jq .body`. `cli.ts` already uses
`execFileSync` for `git rev-parse`, so the precedent and the import exist. **If `gh` is missing or the
call fails, say so in one sentence and name the flag form** - not a stack trace, and not a suggestion
to install anything.

**The output** names the identifier, prints the row on its own line so it can be copied, lists the
candidate sections, prints any warnings, and ends with what to do next: paste the row into the section
it belongs in, and put `Fixes #<issue>` in the pull request body so the issue closes. That last line is
the change-control link the whole intake exists for, and it is the one a person forgets.

**It must not write anything.** Make that structural rather than tested: `draft.ts` and `format.ts`
import no `node:fs`, so the logic is incapable of writing, and `cli.ts`'s `draft` case contains nothing
but reading the issue or the flags, reading the area document, calling `draftRequirement`, and printing.
A reviewer can then confirm it by reading one short case.

- [ ] **Step 1: Write the failing formatter test, then implement**

- [ ] **Step 2: Exercise the `gh` path against an issue that already exists**

**Do not file a test issue.** It would put noise in the tracker and consume a number from the sequence
this repository shares between issues and pull requests. Instead run `pnpm trace draft 62` - issue #62
exists and is a bug report, not a filed requirement - and confirm the command **fails legibly**, naming
which required heading it could not find and pointing at the flag form. That exercises the shell-out,
the body retrieval and the error path together, and the error path is the one somebody will actually hit
by running `draft` against the wrong number. Put the verbatim output in your report.

If `gh` is unavailable or unauthenticated where you are, say so and report what the command printed - a
legible message about `gh` is also a pass for this step, and is the other branch worth seeing.

- [ ] **Step 3: Run the flag form, which is the happy path**

```bash
pnpm trace draft --area CNT --statement "A footnote must be able to carry a citation" --tranche T1 --issue 62
```

Confirm it prints `CNT-142`, a row that would parse, the candidate sections of the CNT document, and the
reminder about `Fixes #62` in the pull request body. Put the verbatim output in your report, and **do not
add the row to the corpus** - it is an example, not a requirement anybody asked for.

- [ ] **Step 4: Commit**

---

## Task 5: The paperwork

**Files:** `docs/architecture.md`, `CLAUDE.md`, `docs/specification/requirements/README.md`,
`docs/plans/README.md`, `CHANGELOG.md`, `version.json`, `package.json`,
`apps/desktop/package.json`

- [ ] **Step 1: Documentation**

- `docs/specification/requirements/README.md` - the paragraph on how a requirement is written gains
  how one now arrives: the form, `draft`, and that a person places the row. Say that `draft` never
  inserts it, and why.
- `CLAUDE.md` - `pnpm trace draft` in the commands, and one line in the issues-and-pull-requests
  section that a requirement arrives by issue form.
- `docs/architecture.md` - the `packages/trace` row gains intake.
- `docs/plans/README.md` - the stage 4 row, `Built (PR #NN)`, and **mark the Traceability section
  complete** in the same voice the Scaffolding section uses now that it is finished.

- [ ] **Step 2: Version** `0.13.0` to `0.14.0` in all three mirrors.

- [ ] **Step 3: Changelog.** Plain hyphens. Cover the form, `draft`, that it prints rather than
      inserts and why, and that the design's four stages are now built. **Leave `#NN` literal.**

- [ ] **Step 4:** `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm trace gate`. All
      five must pass, and the gate must still be 7 of 7 - this stage adds no requirement and so must
      not move it. **Do not push and do not open a pull request.**

---

## Expected test counts, so a lost test cannot hide

`packages/trace` has **224 tests across 17 files** before this plan. Expect:

| File                  | Tests | Source        |
| --------------------- | ----- | ------------- |
| `intake.test.ts`      | 6     | Task 1 Step 1 |
| `parse/issue.test.ts` | 9     | Task 2 Step 1 |
| `draft.test.ts`       | 6     | Task 3 Step 1 |
| `format.test.ts`      | +2    | Task 4 Step 1 |

That totals **247 across 20 files**. Report the actual numbers rather than adjusting to reach these; if a
count differs, say which and why.

## What this plan deliberately leaves undone

- **`draft` does not write.** Decision 1 above. If the author later wants a `--into "<heading>"` that
  appends to a named section's table, the pieces are all here - but the judgement it automates is the
  one worth keeping manual, and nothing in three stages of this work has made a tool better at it.
- **No requirement is added to the corpus.** The test issue filed in Task 4 is closed, not landed.
  Filing a real requirement is a product decision.
- **The identifier collision the design names stays.** Two branches can both take `CNT-142`; the
  contiguity check refuses the merge and the later one renumbers. A server would fix it and is not
  worth it.
- **The seven corpus problems remain**, and the gate still does not fail on them, because none is
  about a requirement the release claims.
