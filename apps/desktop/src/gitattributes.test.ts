import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Line endings (`.gitattributes`). Here with the other repository-wide checks, for the reason
 * `decisions.test.ts` gives. Every file git reads as binary must be marked so: left to `text=auto`, a
 * checkout that normalises line endings can rewrite bytes inside it - a font whose hash is pinned, a PDF
 * a test reads by its bytes - with a diff that says nothing changed.
 */
const root = join(process.cwd(), '..', '..');
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

describe('the repository line endings', () => {
  it('marks every file git reads as binary as binary, so no checkout normalises its bytes', () => {
    const binary = git('ls-files', '--eol')
      .split('\n')
      .filter((line) => line.startsWith('i/-text'))
      .map((line) => line.split('\t')[1]!)
      .filter((path) => path !== undefined);
    expect(binary.length).toBeGreaterThan(0);
    const unmarked = git('check-attr', 'binary', '--', ...binary)
      .split('\n')
      .filter((line) => line.endsWith(': binary: unspecified'))
      .map((line) => line.replace(/: binary: unspecified$/, ''));
    expect(unmarked).toEqual([]);
  });
});
