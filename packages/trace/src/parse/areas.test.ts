import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../compile.js';
import { parseAreaIndex } from './areas.js';

describe('parsing the areas index', () => {
  it('reads each area row into its code and name, in the order the index lists them', () => {
    const text = [
      '## Areas',
      '',
      '| Code    | Area             | Scope § | Document                                           |',
      '| ------- | ---------------- | ------- | -------------------------------------------------- |',
      '| **ZZB** | Invented second  | 7.2     | [ZZB-invented-second.md](ZZB-invented-second.md)   |',
      '| **ZZA** | Invented, first  | 7.1     | [ZZA-invented-first.md](ZZA-invented-first.md)     |',
      '',
    ].join('\n');

    expect(parseAreaIndex(text)).toEqual([
      { code: 'ZZB', name: 'Invented second' },
      { code: 'ZZA', name: 'Invented, first' },
    ]);
  });

  it('ignores every other table, so a bolded requirement identifier is not taken for an area', () => {
    const text = [
      '| Artifact (scope §6) | Owned by | Note |',
      '| ------------------- | -------- | ---- |',
      '| **Component**       | CNT      |      |',
      '',
      '| ID          | Requirement             | Tranche | Status    |',
      '| ----------- | ----------------------- | ------- | --------- |',
      '| **ZZZ-001** | A widget must glow      | T1      | Specified |',
    ].join('\n');

    expect(parseAreaIndex(text)).toEqual([]);
  });

  it('reads the real index: every area, starting where the scope starts', () => {
    const index = parseAreaIndex(
      readFileSync(join(REPO_ROOT, 'docs', 'specification', 'requirements', 'README.md'), 'utf8'),
    );

    expect(index[0]).toEqual({ code: 'CNT', name: 'Content and authoring' });
    expect(index.map((area) => area.code)).toContain('MET');
    expect(new Set(index.map((area) => area.code)).size).toBe(index.length);
  });
});
