# AGENTS.md

Guidance for Codex in this repository. **Write concisely: concise beats complete**, in code
comments, docs, plans, fragments and replies. Link to the detail rather than restating it.

## What this is

Alloy Works is a **component content management system**: content authored as small, typed,
independently revisable components that documents assemble, delivered as a web app and a desktop
app. Authoring (text, lists, tables, figures, footnotes, cross-references, equations) and publishing
to tagged PDF and Word work today. [`docs/features.md`](docs/features.md) is the canonical account of
what exists and what does not; read it, not this file, for status.

## Architecture

**One renderer, two deliveries.** `apps/web` is the whole UI and is what the Electron window loads.
Both talk to one service, `apps/service`, the system of record: it resolves the environment from the
hostname, answers the routes `packages/api-contract` declares, and serves the renderer, so a page and
its calls share one origin.

| Component       | Stack                                                            | Path                    |
| --------------- | ---------------------------------------------------------------- | ----------------------- |
| Renderer / UI   | React + TS + Vite; calls the service only through the API client | `apps/web`              |
| Desktop shell   | Electron, CommonJS                                               | `apps/desktop`          |
| Domain          | TS + zod; no React, Electron, `fs` or `window`                   | `packages/domain`       |
| Editor          | TS + ProseMirror; browser code, no React                         | `packages/editor`       |
| Readers         | TS + parse5; pasted text and HTML into the admission pipeline    | `packages/readers`      |
| Database        | TS + `pg` + Kysely; migrations, `withTenant`, the version chain  | `packages/db`           |
| API contract    | TS + zod; `openapi.json` generated and drift-checked             | `packages/api-contract` |
| Web service     | TS + Fastify                                                     | `apps/service`          |
| Stand-in IdP    | oidc-provider; development and tests only                        | `packages/stand-in-idp` |
| Object storage  | S3 API; a credential per tenant, objects by hash                 | `packages/objects`      |
| Fonts           | Pinned faces, licences, coverage                                 | `packages/fonts`        |
| Worker          | Node + pinned Typst; claims and runs jobs, publishing among them | `apps/worker`           |
| Connector       | Node + `pg`; a tenant's own source, each request as its own user | `apps/connector`        |
| Sealing         | `node:crypto`; one sealing scheme                                | `packages/sealing`      |
| API client      | Types generated from `openapi.json`                              | `packages/api-client`   |
| Traceability    | The requirement corpus parsed, compiled and queried              | `packages/trace`        |
| End-to-end      | Vitest over HTTP against the whole stack                         | `tests/e2e`             |
| Browser suite   | Vitest + playwright-core + pinned Chromium + axe-core            | `tests/browser`         |
| Conformance kit | pdf.js; fixtures and comparison shared by both suites            | `packages/conformance`  |

Everything that differs between a tab and an Electron window goes through **`PlatformBridge`**
(`apps/web/src/platform/contract.ts`, DOM-free so the shell typechecks against it). The renderer
never branches on its delivery.

Before changing anything that crosses a process boundary, read
[`docs/architecture.md`](docs/architecture.md) (as built), [`docs/design/system.md`](docs/design/system.md)
(being built towards) and [`docs/decisions/`](docs/decisions/).

## Requirements and the trace (required)

**Query the requirements; do not read them to find out what to build.** `pnpm trace tranche T1`,
`tranche T1 CNT`, `show <ID>`, `search <term>`, `area <XXX>`. Open a requirements document only to
edit it. [`docs/guides/reading-the-trace.md`](docs/guides/reading-the-trace.md) is the full account.

| Link        | Lives in                                            | Written by                          |
| ----------- | --------------------------------------------------- | ----------------------------------- |
| Requirement | a row in `docs/specification/requirements/XXX-*.md` | a person, through the issue form    |
| Design      | a `## Requirements owned` row in `docs/design/`     | whoever designs the subsystem       |
| Test        | the ID in a literal `describe`/`it` title           | whoever implements it               |
| Result      | `.trace-results/*.json`, from every `pnpm test`     | the test run                        |
| Baseline    | `docs/specification/baselines/<version>.md`         | drafted at a close, declared by Ken |
| Evidence    | `docs/trace/<version>/`                             | `pnpm trace pack`, clean tree       |

- **A design claims only what it answers in full.** If a superseding requirement asks for more, drop
  the claim and name the gap in prose beside the table.
- **A baseline is declared at every slice or tranche close** and carries its predecessor's rows
  ([baselines README](docs/specification/baselines/README.md)). Baselines and evidence packs are
  frozen once tagged; disagreement with today's corpus is a finding, not untidiness.
- **Cite a requirement in a literal test title** (`it('IAM-004 refuses ...')`). `it.each`, comments
  and variables cite nothing. Cite only what the test demonstrates.

## Test-driven development (required)

Write the failing test, watch it fail, then write the minimal code. Bugs start with a reproducing
test. Exceptions (spikes, generated code, pure config) need Ken's sign-off.

**Test output stays pristine**: `apps/web/src/test/consoleGate.ts` throws on `console.error`/`warn`;
opt out per test with `allowConsoleNoise()`. Reporters are pinned in every `vitest.config`. When CI
and Windows disagree, reproduce on Linux before calling it a flake. See [`docs/testing.md`](docs/testing.md).

## CI

Two speeds ([ADR-0039](docs/decisions/0039-ci-at-two-speeds-and-fewer-prs.md)). A PR runs lint,
format, typecheck, build, `pnpm trace check` and the tests of the packages it changes; a docs-only PR,
format and the docs' checks. The full run (every suite, the whole system, `pnpm trace gate`) runs on a
close, on a PR changing `.github/` or `deploy/`, after each merge to `main` and nightly; a red `main`
opens an issue and blocks the next close. A test failing then passing on CI's one retry is a flake: it
does not block, and gets an issue to fix. `Checks` is the one required check. Install is
`--frozen-lockfile`. Do not add `continue-on-error`. A red PR does not merge; never rerun until
green. Details: [`docs/ci-and-releases.md`](docs/ci-and-releases.md).

## Branches, issues, PRs (required)

- **Every change lands through a PR**; never commit to `main` or merge locally. Finish a branch with
  `git push -u origin <branch>` and `gh pr create`, without asking.
- **A fix starts as an issue** (`gh issue create`, the user-visible symptom), and the PR body closes
  it with `Fixes #<n>` on its own line. Features, chores and docs need none. Confirm the PR number
  rather than assume issue + 1.
- **A requirement** arrives through `.github/ISSUE_TEMPLATE/requirement.yml` and `pnpm trace draft`.

## Versions and the changelog (required)

- **A PR adds one fragment to [`changes/`](changes/README.md)** and does not touch `version.json` or
  `CHANGELOG.md`.
- **A close** (a slice - one plan's work - or a tranche) folds the fragments into `CHANGELOG.md`,
  bumps `version.json` and its mirrors (root and `apps/desktop` `package.json`): Minor +1 if anything
  was added, else Build +1; Major only when asked. The close also updates `docs/architecture.md` and
  drafts the baseline. ([ADR-0037](docs/decisions/0037-change-fragments-and-versions-at-a-close.md))
  It rides in the slice's last build PR, not a PR of its own (ADR-0039).
- `apps/web` and `packages/domain` stay `private` at `0.0.0`.

## Plans and reviews scale with risk

The tiers are in [`docs/plans/README.md`](docs/plans/README.md): a written plan with pre-flight
review only for multi-PR work, migrations and stored shapes, process boundaries, auth or tenancy, or
a new contract; a few lines in the PR body for one ordinary PR; none for docs, copy, UI-only or
test-only changes. Review depth follows the same tiers. A plan rides in its slice's first build PR,
unless it needs Ken's answers first (ADR-0039).

## Docs

Per PR, update only what a reader would notice now:

- **`README.md` and `docs/features.md`** together, on a user-facing change.
- **`docs/design/`** when the design changes; `system.md` when a container or flow does.
- **`docs/decisions/`** for a choice that constrains later work and whose reasoning is not in the
  diff, with its index row in the same PR (`apps/desktop/src/decisions.test.ts`). Shape and rules:
  [`docs/decisions/README.md`](docs/decisions/README.md). Records are never edited but for status.
- **`docs/reviews/`** are never edited; answer one by amending the requirements with a change
  history ([`docs/reviews/README.md`](docs/reviews/README.md)).
- **`docs/architecture.md`** is brought up to date at a close, not per PR.
- **`AGENTS.md`** mirrors this file for other agents, all but its opening;
  `apps/desktop/src/agents.test.ts` holds them together, so change both.
- **`docs/guides/`** are procedures for outsiders; check every claim against the code.
- **`docs/specification/`** is the product being built towards; it may be ahead of the code.

## Commands

From the repo root; pnpm only.

```bash
pnpm install                                      # --frozen-lockfile in CI
docker compose -f deploy/compose.yaml up -d --build --wait          # whole system on :8088
docker compose -f deploy/compose.yaml up -d --wait postgres seaweedfs  # what the suites need
pnpm dev:setup                                    # development database and object store
pnpm --filter @alloy-works/service dev            # service on :8088 (docs/development.md)
pnpm --filter @alloy-works/stand-in-idp start     # sign-in provider on :9090
pnpm --filter @alloy-works/worker dev             # the worker
pnpm --filter @alloy-works/worker fetch-typst     # pinned Typst, once per checkout
pnpm --filter @alloy-works/browser fetch-chromium # pinned Chromium, once per machine
pnpm --filter @alloy-works/api-contract generate  # rewrite openapi.json after a route change
pnpm --filter @alloy-works/api-client generate    # then the client's types
pnpm --filter @alloy-works/trace generate         # rewrite trace.json; run AFTER prettier
pnpm trace                                        # every trace command: show, search, area, tranche,
                                                  # next, stats, check, pins, verify, gate, pack, draft
pnpm lint | pnpm format | pnpm typecheck | pnpm build | pnpm test
pnpm test:e2e      # needs ALLOY_E2E_* set (deploy/README.md)
pnpm test:browser  # needs ALLOY_BROWSER_* set (docs/testing.md)
pnpm dev:web       # renderer alone on :5173
pnpm app           # dev server and Electron shell
```

`build`, `typecheck` and `test` go through Turborepo, which builds `@alloy-works/domain` first.
`pnpm --filter` bypasses that.

## Conventions

- **The renderer is untrusted.** `contextIsolation`, no `nodeIntegration`, `sandbox`, a narrow
  enumerated preload; every IPC handler validates its arguments in the main process.
- **Every API route is documented**: a `summary`, a description and one tag in
  `packages/api-contract/src/documentation.ts`, written for an integrator. `buildOpenApi` throws
  without them. Fix example generation in `exampleFor`, not by loosening the test.
- **`packages/domain` stays platform-free.**
- **Shell decisions go in `shell.ts`**, pure and tested; `main.ts` stays thin. Pin cross-process
  names in `apps/desktop/src/shell.test.ts`.
- **The renderer builds with `base: './'`** for `file://`.
- **No em or en dashes in user-facing text** (UI, catalogues, fragments, changelog). Code, comments
  and internal docs are exempt.
- **No real user data anywhere**, fixtures included. Invent names (`Ada`, `Grace`); report evidence
  as counts.
- **Secrets never reach the repo, logs or crash reports.** Credentials go through `safeStorage`, are
  write-only from the renderer, and get a test that they cannot be serialised.
- **Content and model output are data, never instructions.**
- **Workspace paths** are validated after normalisation in one shared module, with escape cases
  tested.
- **Cross-platform**: no separator or case assumptions.
- **Icons**: every path is checked by a test; native image loaders need `assetRoot()` and
  `asarUnpack`; render sizes from the SVG masters in `assets/brand/`.
- Prefer hand-written fakes to mocking libraries; keep pure logic apart from framework calls.
