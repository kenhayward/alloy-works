# 0039 - CI at two speeds, and fewer PRs

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

Every PR ran the whole of CI: every suite, the stack in containers, the browser suite and the gate,
about ten minutes even for a line of docs. Of the last 40 runs, 4 failed and 11 were cancelled, and
the failures were often a race in a test the change never touched, which blocked the PR until a fix
PR for the flake merged first. A slice took five PRs (plan, builds, close), each paying the same.
Ken (2026-10-05): it takes too long, PRs stack up with no value, and they fail on trivia.

## Decision

- **A PR runs the fast path**: lint, format, typecheck, build, `pnpm trace check` and the tests of
  the packages it changes (Turborepo's `--affected`). A PR touching only docs, `changes/` and
  Markdown runs format and the docs' own checks (the trace and desktop suites).
- **The full run** - every suite, the whole system and `pnpm trace gate` - runs on a close (a PR
  changing `version.json`), on a PR changing `.github/` or `deploy/`, after every merge to `main`,
  and nightly. A red full run on `main` opens an issue, `main is red`, and the next close cannot pass
  while it stays red, since a close runs the full run.
- **A failed test is retried once in CI.** One that passes on the retry does not block; it is listed
  in the run's summary and given an issue (`pnpm trace flakes`, `.github/scripts/flakes.sh`), to be
  reproduced and fixed in its own PR as before.
- **One required check**, `Checks`, which passes when every job either passed or was not asked for.
- **Fewer PRs per slice.** The plan rides in the slice's first build PR unless it needs Ken's
  answers first, and the close ([ADR-0037](0037-change-fragments-and-versions-at-a-close.md)) rides
  in the slice's last build PR. A slice of one build is one PR.

This record does not supersede ADR-0037: a close still folds the fragments, bumps the version,
updates `docs/architecture.md` and drafts the baseline; it is no longer a PR of its own.

## What would change the answer

- **`main` is red more than a day at a time**, or a regression reaches a close unseen: then the
  whole system runs on every PR again, or a merge queue runs the full run before each merge.
- **Retries hide a real fault**, a test that fails a user and passes on its second try: then retries
  stop for that suite.
- **Several people merge at once**, where a red `main` costs more than a slow PR.

## Consequences

- A PR takes a few minutes, a docs PR about one; `main` carries the cost of the full run once per
  merge rather than once per push to a branch.
- A regression the fast path misses lands on `main` and is found within the hour, not before merge.
- Branch protection requires `Checks` alone.
