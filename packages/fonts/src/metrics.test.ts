import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { capHeightOfFile, PINNED_FONT_FILES } from './index.js';
import { capHeight, FONT_DIRECTORY } from './node.js';

describe("each pinned face's cap height, as data", () => {
  it('is the cap height its own file declares, over its em, which the editor trims a line to', async () => {
    for (const pinned of PINNED_FONT_FILES) {
      const file = await readFile(join(FONT_DIRECTORY, pinned.file));
      expect(pinned.capHeight, pinned.file).toBe(capHeight(file));
    }
  });

  it('is known by the hash a theme names its file by, and not for a file nobody pinned', () => {
    expect(capHeightOfFile(PINNED_FONT_FILES[3].sha256)).toBe(1341 / 2048); // Liberation Serif
    expect(capHeightOfFile('0'.repeat(64))).toBeUndefined();
  });
});
