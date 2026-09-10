# Testing

## Test-driven development is required

**Write the failing test first, watch it fail, then write the minimal code to pass.** No production
code without a failing test that preceded it. This applies to new features, bug fixes and behaviour
changes alike. When fixing a bug, the first commit-worthy artefact is a test that reproduces it
(red); then the fix (green).

Watching it fail is not ceremony. A test that passes before the implementation exists is testing
nothing, and you only find that out by running it red first.

Exceptions - throwaway spikes, generated code, pure configuration - need a human's sign-off.

## The suites

| Workspace         | Runner | Environment | Covers                                                              |
| ----------------- | ------ | ----------- | ------------------------------------------------------------------- |
| `packages/domain` | Vitest | node        | The content model and its rules                                     |
| `apps/web`        | Vitest | jsdom       | The renderer, via Testing Library                                   |
| `apps/desktop`    | Vitest | node        | The shell's pure decisions - target resolution, the bridge contract |

`pnpm test` runs all three. The reporter is **pinned explicitly** in every `vitest.config`: left
implicit, some runners print nothing a test logged on Windows while the identical run on Linux
prints all of it, which makes a local run look pristine while CI drowns.

## Keep test output pristine

**A passing run has no errors and no warnings.** This is wired as a hard gate rather than left to
discipline: `apps/web/src/test/consoleGate.ts` replaces `console.error` and `console.warn` for the
duration of every test and **throws** from inside them, so the failure names the source line that
produced the noise. An assertion in `afterEach` could only say that noise happened somewhere.

React's `act(...)` warning goes through `console.error`, so the gate catches it too.

A test that provokes an error or warning on purpose opts out explicitly:

```ts
import { allowConsoleNoise } from './test/consoleGate.js';

it('warns when the bridge is missing', () => {
  allowConsoleNoise();
  // ...
});
```

The gate re-arms for the next test. The opt-out is per test, never per file.

## What belongs where

- **Rules expressible over data** belong in `packages/domain` as pure functions, tested in the node
  suite. They are the cheapest tests to write and the most useful when they fail.
- **Anything the shell decides** - which URL to load, what the bridge reports - belongs in a pure
  module (`apps/desktop/src/shell.ts`) rather than inside `main.ts`, so it can be tested without
  booting Electron. `main.ts` stays a thin layer that calls Electron with what those functions
  return.
- **Cross-process contracts** get their channel names and payload shapes pinned by a test. A rename
  on one side without the other is a blank window, not a build error.

Prefer a hand-written fake over reaching for a mocking library, and keep pure logic in separate
modules from the framework calls so it can be unit tested without booting the app.

## Not wired up yet

**There is no browser suite.** jsdom has no layout engine, so any question about _rendered_ output -
geometry, measurement, what an editor actually draws - cannot be answered there; a test asserting it
would be testing jsdom's polyfill. When the product grows a surface that needs it, add a Playwright
suite as `pnpm test:browser` and run it as a separate CI step. Until then, do not fake it in jsdom.

**There is no coverage gate.** Adding one before the product exists would measure the scaffolding.
