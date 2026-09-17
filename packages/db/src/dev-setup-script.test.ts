import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `pnpm dev:setup` runs each package's setup through `pnpm --filter`, which builds nothing. A setup
 * imports other workspace packages through their built `dist/`, so on a checkout that has never been
 * built it fails unless the root script builds those first (issue #107).
 */
const script =
  (
    JSON.parse(
      readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8'),
    ) as { scripts: Record<string, string | undefined> }
  ).scripts['dev:setup'] ?? '';

const steps = script.split('&&').map((step) => step.trim());

function filtersOf(step: string): string[] {
  return [...step.matchAll(/--filter\s+"?([^"\s]+)"?/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

describe('the root dev:setup script', () => {
  it('builds what each package setup imports before running that setup', () => {
    const setups = steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => step.endsWith('dev:setup'));
    expect(setups.length).toBeGreaterThan(0);

    for (const { step, index } of setups) {
      const [name] = filtersOf(step);
      const builtBefore = steps
        .slice(0, index)
        .filter((earlier) => earlier.endsWith(' build'))
        .flatMap(filtersOf);
      expect(builtBefore, `${name} setup runs before its dependencies are built`).toContain(
        `${name}^...`,
      );
    }
  });
});
