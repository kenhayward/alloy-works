import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // ProseMirror's model and state need no DOM, so the mapping, the plugins and the commands are
    // tested in Node (component-editor.md, "Where the code lives"). The view is the renderer's.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The page's table budget binds only off a shared runner (W-D), so CI does not run it.
    exclude: [
      ...configDefaults.exclude,
      ...(process.env['CI'] === 'true' ? ['src/boundTables-budget.test.ts'] : []),
    ],
    // Pinned rather than left implicit: the default reporter varies by platform, and a run
    // that swallows console output on Windows makes a noisy suite look pristine locally.
    reporters: ['default', 'json'],
    outputFile: { json: '../../.trace-results/editor.json' },
  },
});
