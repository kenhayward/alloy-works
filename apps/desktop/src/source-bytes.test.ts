import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * No source file carries a NUL byte. Git treats a file holding one as binary, so its diff reads
 * "Binary file not shown" - and the one that did was `packages/domain/src/stored/storable.ts`, the
 * rule keeping unstorable text out of the store, which a review then could not read. A NUL a source
 * file means is written as the escape `\u0000`, never as the character itself.
 *
 * Every file git knows about under `apps/` and `packages/`, tracked or new and not ignored, whose
 * extension is text; images and a Word fixture are binary by nature and are left out by extension.
 * It lives beside `decisions.test.ts` for the reason that file gives.
 */
const repoRoot = join(process.cwd(), '..', '..');

const TEXT = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.sql',
  '.css',
  '.html',
  '.svg',
  '.yml',
  '.yaml',
  '.md',
  '.typ',
  '.webmanifest',
]);

const sources = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard', 'apps', 'packages'],
  { cwd: repoRoot, encoding: 'utf8' },
)
  .split('\0')
  .filter((path) => path !== '' && TEXT.has(extname(path).toLowerCase()));

describe('the source files', () => {
  it('are found, so the check below is checking something', () => {
    expect(sources.length).toBeGreaterThan(100);
    expect(sources).toContain('packages/domain/src/stored/storable.ts');
  });

  it('carry no NUL byte, which would make git show a file as binary', () => {
    const holding = sources.filter((path) => readFileSync(join(repoRoot, path)).includes(0));
    expect(holding).toEqual([]);
  });
});
