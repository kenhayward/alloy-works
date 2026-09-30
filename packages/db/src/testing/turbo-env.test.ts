import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Turborepo runs `pnpm test` in strict environment mode: a variable no task names never reaches the
 * suites, and each one falls back to its default, the development stack (issue #365). So every
 * ALLOY_TEST_ variable a suite reads must be passed through for every task.
 */
const root = fileURLToPath(new URL('../../../../', import.meta.url));

function sources(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) found.push(path);
  }
  return found;
}

function variablesRead(): Set<string> {
  const read = new Set<string>();
  for (const top of ['apps', 'packages', 'tests']) {
    for (const file of sources(join(root, top))) {
      for (const match of readFileSync(file, 'utf8').matchAll(
        /process\.env\.(ALLOY_TEST_[A-Z0-9_]+)/g,
      )) {
        if (match[1] !== undefined) read.add(match[1]);
      }
    }
  }
  return read;
}

describe('the suites under pnpm test', () => {
  it('receive every ALLOY_TEST_ variable they read, because turbo passes each through', () => {
    const read = variablesRead();
    expect(read.size).toBeGreaterThan(0);
    const turbo = JSON.parse(readFileSync(join(root, 'turbo.json'), 'utf8')) as {
      globalPassThroughEnv?: string[];
    };
    const passed = new Set(turbo.globalPassThroughEnv ?? []);
    expect([...read].filter((name) => !passed.has(name)).sort()).toEqual([]);
  });
});
