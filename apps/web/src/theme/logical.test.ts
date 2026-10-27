import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..');

const stylesheets = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? stylesheets(join(dir, entry.name))
      : entry.name.endsWith('.css')
        ? [join(dir, entry.name)]
        : [],
  );

/**
 * A side named where a language's direction decides it: a margin, padding or border by its side, a
 * position by `left` or `right`, an alignment or a float, and a slide along x that ignores the
 * direction. A line saying why it is physical, `/* physical: ... *\/`, is let be.
 */
const PHYSICAL =
  /\b(?:(?:margin|padding|border)-(?:left|right)|(?<![\w-])(?:left|right)\s*:|text-align:\s*(?:left|right)|float:\s*(?:left|right)|translateX\((?!calc\([^)]*var\(--inline-sign\)))/;

describe('the stylesheets right to left (the UI plan, UI-G)', () => {
  it('LOC-004 lays every side out by the inline start and end, never by left and right', () => {
    const physical = stylesheets(SRC).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, index) =>
          PHYSICAL.test(line) && !line.includes('/* physical:')
            ? [`${relative(SRC, file)}:${index + 1}: ${line.trim()}`]
            : [],
        ),
    );
    expect(physical).toEqual([]);
  });
});
