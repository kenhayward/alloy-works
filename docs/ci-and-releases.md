# CI, branches and releases

## The pipeline

`.github/workflows/ci.yml` runs at two speeds ([ADR-0039](decisions/0039-ci-at-two-speeds-and-fewer-prs.md)).
A newer push to a branch cancels the older run.

| Path | When                                                                                     | Runs                                                                                                 |
| ---- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Docs | A PR touching only `docs/`, `changes/`, Markdown and `trace.json`                        | Format, the trace and desktop suites, `pnpm trace check`                                             |
| Fast | Any other PR                                                                             | Lint, format, typecheck, build, `pnpm trace check`, and the tests of the packages the change reaches |
| Full | A close (`version.json` changed), a PR changing `.github/` or `deploy/`, `main`, nightly | Every suite, the whole system and the gate                                                           |

| Job                 | Runs                                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| What changed        | The path, and what the change reaches: `.github/scripts/reach.js` over `turbo ls --affected`, the changed packages and their dependents |
| Lint, typecheck...  | The checks, every package's tests but the five suites', and on the full run the images built and started                                 |
| The `<suite>` suite | The connector's, service's, database's, web's and worker's suites, a job each, on either path, each only if reached                      |
| The whole system    | Full run: the stack in containers, `pnpm test:e2e` and `pnpm test:browser` but `budgets.test.ts`                                         |
| Traceability gate   | Full run: `pnpm trace gate` over every job's reports                                                                                     |

- **`Checks` is the one required check**: every job passed or was not asked for. On `main` a red
  full run opens an issue, `main is red`, or comments on the open one; a close runs the full run, so
  it cannot pass while `main` is red.
- **A failed test is retried once** (`-- --retry=1`). One that passes on the retry does not block:
  `pnpm trace flakes` finds it in the reports and `.github/scripts/flakes.sh` lists it in the run's
  summary and opens an issue, `Flaky test: <file> > <name>`, or comments on the open one.
- **Install is frozen.** A loose install can resolve a different tree than the lock file names.
- **The full run's Test keeps `continue-on-error`** so its JSON reports still upload; the gate then
  refuses a failed run, so a red test still fails the build. The fast path has no gate, and its test
  step blocks.
- **The end-to-end and browser steps** set every address they drive to the job's own stack. Neither
  suite has a default ([deploy/README.md](../deploy/README.md#running-the-suites-against-a-stack)).
- **Five suites have a job each**, beside the build job, on the fast path as on the full run: on one
  runner, a change to a package they all depend on took nine minutes. The service's and database's
  suites run one file at a time without isolation, so a file reuses the modules the one
  before it loaded. The stack's
  images are built with layers from the Actions cache, one scope a target, written by the
  whole-system job; a pull request reads `main`'s cache, never another branch's.
- **The navigation budgets run only off CI.** They bind only on the reference machine (B-P), so
  `tests/browser/vitest.config.ts` leaves `budgets.test.ts` out where `CI` is `true`.

### The traceability gate

`pnpm trace gate` runs in its own job after the other two, reading every suite's report from
`.trace-results/` (uploaded as `trace-results-build`, `-system` and one per suite, and downloaded together). It fails when:

- a requirement the newest baseline includes is not verified;
- the baseline itself is malformed;
- a report is failed, stale, or missing (`e2e.json` and `browser.json` are checked for explicitly).

A baseline is declared at every slice or tranche close ([ADR-0037](decisions/0037-change-fragments-and-versions-at-a-close.md)),
so the gate grows with what has shipped.

### `test` tasks are uncacheable, on purpose

Every `test` task in `turbo.json` has `cache: false`. Each suite writes its report to
`.trace-results/`, outside what Turborepo hashes, so a cache hit would replay old logs and leave a
stale report. Do not add caching back to a `test` task.

### Turborepo's logs are streamed

`TURBO_LOG_ORDER: stream` prints each line as it happens, prefixed with its task. Filter the log on a
prefix such as `@alloy-works/worker:test:` to read one package.

### Branch protection

`main` requires a pull request and **Checks**.

A PR that does not go green does not merge. Fix or quarantine a flaky job in its own PR with an
issue; never rerun until green.

## Branches, issues and pull requests

- **Every change lands through a PR.** `git push -u origin <branch>` then `gh pr create`. Never commit
  to `main` or merge locally.
- **Every fix starts as an issue** written from the user-visible symptom, and the PR body closes it
  with `Fixes #<n>` on its own line. Features, chores and docs need no issue. Check the issue closed
  after the merge.

## Versions and the changelog

**Major.Minor.Build**; the canonical version is `/version.json`, mirrored by the root `package.json`
and `apps/desktop/package.json` (electron-builder stamps it into the installer).

- **A PR** adds a fragment to [`changes/`](../changes/README.md). It does not touch the version or
  `CHANGELOG.md`.
- **A close** (a slice or a tranche) folds the fragments into one `CHANGELOG.md` entry and bumps the
  version: Minor +1 if any fragment adds something, else Build +1. Major only when Ken asks. The
  checklist is in [`changes/README.md`](../changes/README.md).
- `apps/desktop/src/version.test.ts` checks the mirrors, the newest changelog heading and the
  fragments.
- `apps/web` and `packages/domain` stay `private` at `0.0.0`. If something starts reading one, add a
  mirror and extend that test.

## Releases

**There is no release process yet.** `pnpm --filter @alloy-works/desktop package` builds an
installer locally ([development.md](development.md)); nothing is signed, notarised or published.
Packaging on CI belongs on a tag. Before a real release: Windows signing, macOS notarisation and an
auto-update decision.
