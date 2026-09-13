# CI, branches and releases

## The pipeline

`.github/workflows/ci.yml` runs on every push to `main` and every pull request. A second push to the
same branch cancels the first, so no minutes go to a commit nobody is waiting on.

| Step              | Command                          | Blocking today?          |
| ----------------- | -------------------------------- | ------------------------ |
| Install           | `pnpm install --frozen-lockfile` | **Yes**                  |
| Lint              | `pnpm lint`                      | No - `continue-on-error` |
| Format            | `pnpm format`                    | No - `continue-on-error` |
| Typecheck         | `pnpm typecheck`                 | No - `continue-on-error` |
| Build             | `pnpm build`                     | No - `continue-on-error` |
| Test              | `pnpm test`                      | No - `continue-on-error` |
| Traceability gate | `pnpm trace gate`                | **Yes**                  |

Install is deliberately **not** `continue-on-error`: a lock file that will not install should stop
the run, because every step after it would be testing a tree nobody agreed to. And it is
`--frozen-lockfile`, never a loose install - a loose install can resolve a different tree than the
lock file names, which is the entire reason for committing one.

### The traceability gate is the first real check in this pipeline

`pnpm trace gate` runs after `Test`, because it reads the JSON reports that step writes to
`.trace-results/`, and it is the first step in this file that is **not** `continue-on-error`. That is
safe precisely because of what the gate checks: `docs/specification/baselines/` declares the
requirements this release is answerable for, each with its own evidence, so the gate passes on the
day the baseline lands - it fails only when a later change breaks a requirement the baseline already
claims, or breaks the declaration itself. A check that starts red the day it is added is not a gate,
it is a chore nobody will get to; this one starts green because the scope it enforces was chosen to
match what is already true.

This is **not** the beginning of the switch-over described below. Lint, format, typecheck, build and
test are still advisory, under their own temporary comment, and turning them into gates still follows
the checklist in "Turning CI into a gate", ending in branch protection on `main`. The traceability
gate is deliberately narrow: it says nothing about any of those other checks, and does not shorten
that checklist.

### Every `test` task is uncacheable, on purpose

Every workspace's `test` task in `turbo.json` carries `cache: false`. This looks like an oversight -
Turborepo exists to skip work that has not changed - but it is load-bearing, not an accident. Each
`vitest.config.ts` writes its JSON report to `.trace-results/`, a directory outside the package's own
output that Turborepo cannot hash or restore. A cached hit would replay a task's old logs without
running Vitest at all, leaving that package's report missing or stale in `.trace-results/` -
`packages/trace/src/results.ts`'s coherence check now refuses to compute `Verified` from a stale
report for exactly this reason, but a cache hit prevents that check from ever running rather than
tripping it. This is not hypothetical: the generic `test` task and desktop's override were missing
`cache: false` until this was found, and the cache silently left `packages/domain`'s report stale on
a warm run. Do not add caching back to a `test` task without giving it its own way to produce a
`.trace-results` report Turborepo can account for.

## Why the checks are advisory right now

The repo has no baseline. Turning a check into a gate before there is agreement on what it should
enforce produces one of two bad outcomes: a red main that everyone learns to ignore, or a rule
nobody chose being enforced by whatever the linter shipped with. So today CI **reports** and does
not block.

This is temporary, and it is not permission to ignore a red check. A failing step is information -
act on it in the PR that caused it.

### Turning CI into a gate

When the baseline is agreed, in one PR:

1. Remove every `continue-on-error: true` from `.github/workflows/ci.yml`.
2. Confirm the job is green on `main` before, not after.
3. Enable branch protection on `main` requiring the **Lint, typecheck, build and test** check, and
   requiring a pull request to merge.
4. Update the table above and delete this section.

Once it is a gate: **a PR that does not go green does not merge** - no exceptions, no local merges
to route around it. If a job is flaky, fix or quarantine it in its own PR with an issue. Never
rerun until green and merge on the second roll.

## Branches and pull requests

**Every change lands through a pull request.** Do not commit to `main` directly and do not merge
locally - push the branch and open a PR:

```bash
git push -u origin <branch>
gh pr create
```

Branch protection is not switched on yet, which makes this a convention rather than something the
server enforces. Treat it as binding anyway; it becomes enforced when CI becomes a gate.

**Every fix starts as a GitHub issue and ends with the PR closing it.** Open the issue first
(`gh issue create`), written from the **user-visible symptom** - what went wrong, how to reproduce,
what was expected - not from the fix you are about to write. Then put a closing keyword on its own
line in the **PR body**:

```
Fixes #12
```

Notes:

- **Scope: fixes only.** A feature, chore, refactor or docs-only change does not need an issue
  unless someone asks for one. If an issue already exists, reuse its number.
- GitHub only auto-closes from the PR **description** or from a commit on the default branch - not
  from a PR title and not from a later comment. Check the issue actually closed after the merge.
- Issues and PRs share one number sequence, so the PR number is usually the issue number + 1 -
  confirm rather than assume.

## Versioning

The scheme is **Major.Minor.Build**, starting at `0.1.0`. The canonical version is `/version.json`.

- A **functional enhancement** bumps **Minor +1 and resets Build to 0** (`0.1.2` -> `0.2.0`).
- Any other PR - fix, chore, docs, refactor - bumps **Build +1** (`0.2.0` -> `0.2.1`).
- **Only bump Major when explicitly asked.**

The mirrors are the root `package.json` and `apps/desktop/package.json`. The desktop package joined
the list in 0.2.0, when electron-builder started stamping the version into the installer, the
executable's file properties and the Windows uninstall entry - which is exactly the trigger this
section described. `apps/desktop/src/version.test.ts` fails when any mirror drifts, and it checks
the newest changelog entry too.

**The other workspace packages are still not individually versioned** - `apps/web` and
`packages/domain` are `private: true` at `0.0.0`, because nothing publishes them and a version
nobody reads is a version that silently drifts. When something does start reading one, add the
mirror **and extend that test** in the same PR.

## The changelog

**Every PR adds one entry to [`CHANGELOG.md`](../CHANGELOG.md)**, at the top, with the version, the
date, the PR number, and `Added` / `Changed` / `Fixed` bullets as applicable. Write it for someone
who wants to know what changed for them, not for someone reading the diff.

The topmost entry's version must equal `version.json`. There is no test enforcing that yet - add
one when the version starts being read at runtime.

## Releases

**There is no release process yet.** `pnpm --filter @alloy-works/desktop package` builds an
installer locally - see [development.md](development.md) - but nothing is signed, notarised or
published, and CI does not build one. Packaging on CI belongs on a **tag**, not on every PR: it is
slow, it downloads platform toolchains, and a pull request does not need an installer.

Before there is a real release, at minimum: code signing on Windows and notarisation on macOS
(without them users get a SmartScreen or Gatekeeper warning), and a decision about auto-update.
