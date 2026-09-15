import { defineConfig } from 'vitest/config';

// The version chain's load test: slow, so outside `pnpm test`, and run by hand with
// `pnpm --filter @alloy-works/db test:load` against the compose Postgres.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/load/**/*.load.ts'],
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 3_600_000,
    // Pinned, as every suite's reporter is. No JSON report: this run is not evidence for the trace,
    // and writing db.json would overwrite the unit suite's.
    reporters: ['default'],
  },
});
