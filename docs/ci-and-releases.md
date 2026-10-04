# CI, branches and releases

## The pipeline

`.github/workflows/ci.yml` runs on every push to `main` and every pull request. A newer push to a
branch cancels the older run.

| Job               | Step              | Command                                             | Blocks?                      |
| ----------------- | ----------------- | --------------------------------------------------- | ---------------------------- |
| Checks            | Install           | `pnpm install --frozen-lockfile`                    | **Yes**                      |
| Checks            | Lint              | `pnpm lint`                                         | **Yes**                      |
| Checks            | Format            | `pnpm format`                                       | **Yes**                      |
| Checks            | Typecheck         | `pnpm typecheck`                                    | **Yes**                      |
| Checks            | Build             | `pnpm build`                                        | **Yes**                      |
| Checks            | Test              | `pnpm test`                                         | Through the gate (see below) |
| The whole system  | Chromium          | `pnpm --filter @alloy-works/browser fetch-chromium` | **Yes**                      |
| The whole system  | End to end        | `pnpm test:e2e`                                     | **Yes**                      |
| The whole system  | Browser           | `pnpm test:browser`                                 | **Yes**                      |
| Traceability gate | Traceability gate | `pnpm trace gate`                                   | **Yes**                      |

- **Install is frozen.** A loose install can resolve a different tree than the lock file names.
- **Test keeps `continue-on-error`** so its JSON reports still upload; the gate then refuses a failed
  run, so a red test still fails the build.
- **The end-to-end and browser steps** set every address they drive to the job's own stack. Neither
  suite has a default ([deploy/README.md](../deploy/README.md#running-the-suites-against-a-stack)).

### The traceability gate

`pnpm trace gate` runs in its own job after the other two, reading every suite's report from
`.trace-results/` (uploaded as `trace-results-build` and `trace-results-system`). It fails when:

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

### What is left of the switch-over

1. Enable branch protection on `main` requiring **Lint, typecheck, build and test**, **The whole
   system** and **Traceability gate**, and a pull request to merge.

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
