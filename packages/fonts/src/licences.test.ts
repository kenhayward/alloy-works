import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FONT_LICENCES, INTERFACE_FONT_FILES, PINNED_FONT_FILES } from './index.js';
import { FONT_DIRECTORY, INTERFACE_FONT_DIRECTORY } from './node.js';

describe('the licences About shows', () => {
  it('names every family the product holds under exactly one licence file, which is the OFL', () => {
    const named = FONT_LICENCES.flatMap((each) => each.families);
    const held = new Set<string>(
      [...PINNED_FONT_FILES, ...INTERFACE_FONT_FILES].map((each) => each.family),
    );
    expect([...named].sort()).toEqual([...held].sort());
    for (const { file } of FONT_LICENCES) {
      const [folder, name] = file.split('/') as [string, string];
      const text = readFileSync(
        join(folder === 'interface' ? INTERFACE_FONT_DIRECTORY : FONT_DIRECTORY, name),
        'utf8',
      );
      expect(text, file).toContain('SIL OPEN FONT LICENSE Version 1.1');
    }
  });
});
