# Contributing to Alloy Works

Thanks for taking a look. This document is the working agreement written for a person arriving at
the repository. [`CLAUDE.md`](CLAUDE.md) is the same ground rules written for Claude Code, and the
two are kept in step - when they disagree, `CLAUDE.md` is the one to fix.

> **The repository is scaffolding.** There is no content storage, no authoring UI and no publishing
> yet. [`docs/features.md`](docs/features.md) is honest about what does and does not exist.

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
4. Bump the version and add a changelog entry.
5. Push the branch and open a PR. Never merge locally.

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
- **Bump the version and add one changelog entry** - see below.
- **Update the docs it invalidates**, in the same PR. `docs/architecture.md` when a component,
  contract, dependency or packaging detail changes; `README.md` and `docs/features.md` together when
  a user-facing feature changes; a new record in `docs/decisions/` when the PR makes a choice that
  constrains later work.

Commit messages: a short imperative subject line saying what the commit does, and a body explaining
why when the why is not obvious. There is no enforced format.

## Versioning and the changelog

The scheme is **Major.Minor.Build**, and the canonical version is `version.json` (mirrored only by
the root `package.json` - workspace packages are deliberately unversioned).

| Kind of change             | Bump                                                |
| -------------------------- | --------------------------------------------------- |
| Functional enhancement     | **Minor +1, Build reset to 0** - `0.1.2` -> `0.2.0` |
| Fix, chore, docs, refactor | **Build +1** - `0.2.0` -> `0.2.1`                   |
| Anything else              | Ask. Major bumps only when a maintainer says so     |

Then add one entry to the top of [`CHANGELOG.md`](CHANGELOG.md) with the version, the date, the PR
number and `Added` / `Changed` / `Fixed` bullets. Write it for someone who wants to know what
changed for them, not for someone reading the diff.

## Continuous integration

CI runs on every push and every pull request: install, lint, format, typecheck, build, test.

**The check steps are `continue-on-error` right now** - deliberately, while the repository finds its
baseline. CI reports and does not block. That is not permission to ignore a red check: look at it,
and fix it in the PR that caused it. Please do not add new `continue-on-error` steps.

[`docs/ci-and-releases.md`](docs/ci-and-releases.md) has the checklist for turning CI into a real
gate.

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
- **Em or en dashes in user-facing text.** Plain hyphens in UI strings and changelog entries.
  Code, comments and internal docs are exempt.
- Path separator or case-sensitivity assumptions. Windows, macOS and Linux are all first-class.

## Questions

Open an issue. A question that turned out to be a documentation gap is a useful issue.
