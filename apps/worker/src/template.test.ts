import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { PUBLICATION_TEMPLATE } from './template.js';

describe('the publication template', () => {
  it('is the version its number says: an edit is a new version, never a change to this one', async () => {
    const bytes = await readFile(PUBLICATION_TEMPLATE.file);
    // Of the file with LF endings (.gitattributes normalises them). Were this to fail, the template
    // changed: put it back and make templates/publication/2/, never move this hash.
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      'b47cff20caf996fea010a7f8a10b893291d805a8f3d0a1d8e2c6149d10a0fc82',
    );
    expect(PUBLICATION_TEMPLATE).toMatchObject({ name: 'publication', version: 1 });
  });
});
