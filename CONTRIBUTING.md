# Contributing to Alloy Works

Thanks for taking a look. This document is the working agreement written for a person arriving at
the repository. [`CLAUDE.md`](CLAUDE.md) is the same ground rules written for Claude Code, and the
two are kept in step - when they disagree, `CLAUDE.md` is the one to fix.

> [`docs/features.md`](docs/features.md) says what exists and what does not.

## Getting set up

You need **Node 24 or newer** and **pnpm 9.15** (`corepack enable` picks up the pinned version).

```bash
pnpm install
pnpm test
```

If `pnpm test` is not green on a clean checkout, that is a bug - please open an issue.

[`docs/development.md`](docs/development.md) has the full command list and how to run the web and
desktop deliveries.

## The short version

1. Branch off `main`. Never commit to `main` directly.
2. If you are fixing a bug, **open a GitHub issue first**.
3. Write the failing test, watch it fail, then make it pass.
4. Add a change fragment to [`changes/`](changes/README.md).
5. Push the branch and open a PR. Never merge locally.

## Working on the specification rather than the code

Some changes here are to `docs/specification/` rather than to code: the scope, and one requirements
document per capability area. Those have rules of their own, in
[the requirements index](docs/specification/requirements/README.md), and the two that matter most are
that **an identifier is allocated once and never reused**, and that **a requirement which materially
changes gets a new identifier while the old one is marked superseded** - so a citation in an old
commit never comes to mean something else.

Reviews of those documents live in [`docs/reviews/`](docs/reviews/), kept exactly as they arrived.
Answering one means amending the requirements and ending the document with a change history: a row
per change naming the review point behind it, and a row for anything raised that was deliberately not
changed, with the reason. Declining a review point is a legitimate answer; declining it silently is
not. `docs/specification/` still needs a change fragment like any other PR, and
`packages/trace/src/requirements.test.ts` checks the identifiers, the numbering and the index.

## Test-driven development

**This project uses TDD.** Write the failing test first, watch it fail, then write the minimal code
to pass. No production code without a failing test that preceded it - features, bug fixes and
behaviour changes alike.

Watching it fail matters. A test that passes before the implementation exists is testing nothing,
and running it red first is the only way to find that out.

When fixing a bug, the first thing you write is a test that reproduces it. Red, then green.

Exceptions - a throwaway spike, generated code, pure configuration - need a maintainer's sign-off,
so say so in the PR rather than leaving it to be noticed.

**Test output must stay pristine.** A passing run has no errors and no warnings, and this is
enforced: the console gate in `apps/web/src/test/consoleGate.ts` fails a test that logs one. If your
test provokes an error on purpose, call `allowConsoleNoise()` in that test to opt out. Do not
disable the gate.

[`docs/testing.md`](docs/testing.md) covers which suite a test belongs in.

## Issues

**Every bug fix starts as an issue.** Open it before writing the fix:

```bash
gh issue create
```

Write it from the **user-visible symptom** - what went wrong, how to reproduce it, what you expected
instead - not from the fix you have in mind. The issue is the record of the bug; the PR is the
record of the fix, and they are useful separately.

Features, chores, refactors and docs-only changes do not need an issue unless a maintainer asks for
one.

## Pull requests

**Everything lands through a PR.** Push the branch and open one - do not merge locally:

```bash
git push -u origin your-branch
gh pr create
```

Branch protection on `main` is not switched on yet, because CI is still advisory (see below). Treat
the rule as binding anyway; it becomes enforced when CI becomes a gate.

A PR should:

- **Do one thing.** A fix and an unrelated refactor are two PRs.
- **Close its issue**, if it has one, with a closing keyword on its own line in the **PR body**:
  `Fixes #12`. GitHub does not auto-close from a PR title or from a comment. Check the issue
  actually closed after the merge.
- **Add one change fragment** - see below.
- **Update the docs it invalidates**, in the same PR: `README.md` and `docs/features.md` together when
  a user-facing feature changes; a new record in `docs/decisions/` - **and its row in that folder's
  index** - when the PR makes a choice that constrains later work and whose reasoning would
  otherwise have to be reconstructed from the diff.

Commit messages: a short imperative subject line saying what the commit does, and a body explaining
why when the why is not obvious. There is no enforced format.

## Versions and the changelog

A PR adds a fragment to [`changes/`](changes/README.md) and does not touch `version.json` or
`CHANGELOG.md`. A slice or tranche close folds the fragments in and bumps the version
([ADR-0037](docs/decisions/0037-change-fragments-and-versions-at-a-close.md)). Write fragments for
someone who wants to know what changed for them.

## Continuous integration

CI runs on every push and pull request. Lint, format, typecheck, build, the whole-system suites and
the traceability gate block a merge. [`docs/ci-and-releases.md`](docs/ci-and-releases.md) has the
detail.

## Things that will get a PR sent back

- Production code with no test that failed first.
- A test that logs an error or warning without an explicit `allowConsoleNoise()`.
- Anything platform-specific in `packages/domain` - no React, no Electron, no `fs`, no `window`.
  It is the one place rules can be tested without booting anything.
- A widened IPC surface. The preload exposes a narrow, enumerated set of capabilities; there is no
  general "run this for me" bridge, and every handler validates its own arguments in the main
  process. The renderer having already checked is not a check.
- **Real user data anywhere** - names, email addresses, company names, real file paths, document
  contents - in code, comments, **test fixtures**, docs, commit messages, issues or PRs. This holds
  even when the data is your evidence: report counts and percentages instead, and invent fixture
  names (`Ada`, `Grace`, `Alice`).
- Secrets or tokens in the repository, the logs, or anything a crash report could pick up.
- **Em or en dashes in user-facing text.** Plain hyphens in UI strings and change fragments.
  Code, comments and internal docs are exempt.
- Path separator or case-sensitivity assumptions. Windows, macOS and Linux are all first-class.

## Questions

Open an issue. A question that turned out to be a documentation gap is a useful issue.
