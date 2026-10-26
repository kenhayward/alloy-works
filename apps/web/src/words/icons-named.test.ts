import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..');

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? entry.name === 'node_modules'
        ? []
        : sources(join(dir, entry.name))
      : /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
        ? [join(dir, entry.name)]
        : [],
  );

describe('icons are named, never worded (the UI plan, UI-C)', () => {
  it('looks every icon up by its name, so it draws in every interface language', () => {
    const worded = sources(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/\bicon(?::|=\{)\s*(?:say|words)\(/g)].map(
        (match) => `${relative(SRC, file)}: ${match[0]}`,
      ),
    );
    expect(worded).toEqual([]);
  });
});
