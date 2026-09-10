# 0002 - pnpm workspaces with Turborepo

- **Status:** Accepted
- **Date:** 2026-09-10

## Context

The repository holds at least three units from day one - a platform-free domain package, a
renderer, and an Electron shell - and a CCMS will grow more of them, not fewer. They share
dependencies heavily, and each needs its own build, typecheck and test.

The options considered:

- **npm workspaces alone.** Fewest moving parts, ships with Node. No task graph, so ordering is
  hand-rolled in root scripts and nothing is cached.
- **pnpm workspaces with Turborepo.** Strict, fast, disk-cheap installs, plus a task graph that
  knows `apps/web` cannot build before `packages/domain` has emitted its `dist/`, and caches what
  has not changed.
- **Nx.** More power - generators, project graph, affected-only CI - and more configuration surface
  and lock-in than a repo with three packages and no baseline can justify.

## Decision

pnpm workspaces for installs, Turborepo for the task graph.

pnpm's non-flat `node_modules` matters more than the install speed: a package that imports something
it did not declare fails immediately here, rather than working by accident because a sibling hoisted
it. In a repo whose whole point is that `packages/domain` stays free of React and Electron, that is
the boundary being enforced by the tool instead of by review.

Turborepo carries its weight through `dependsOn: ["^build"]` on `build`, `typecheck` and `test`.
Without it, every root script has to remember to build the domain package first, and the day someone
forgets, the failure is a stale `dist/` producing a confusing type error.

## What would change the answer

- **Turborepo, if the graph stays this small.** Three packages do not need caching. Drop it and move
  ordering into root scripts; the workspaces do not change.
- **Nx, if code generation becomes the bottleneck** - many similar packages created often, or CI
  long enough that affected-only runs are worth the configuration.
- **npm, if pnpm's strictness fights a dependency** that assumes a flat tree and cannot be patched.

## Consequences

- One lock file, `pnpm-lock.yaml`. CI installs with `--frozen-lockfile`, never a loose install.
- `packageManager` in the root `package.json` pins the pnpm version; corepack picks it up.
- Filtering to a single workspace (`pnpm --filter ... test`) **bypasses the task graph** - build the
  domain package first, or go through the root script.
- This diverges from the sibling Trypthos repository, which uses npm workspaces. The layout and the
  rules are shared; the package manager is not.
