import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { PUBLICATION_TEMPLATE } from './template.js';

describe('the publication template', () => {
  it('is the version its number says: an edit is a new version, never a change to this one', async () => {
    const bytes = await readFile(PUBLICATION_TEMPLATE.file);
    // Of the file with LF endings (.gitattributes normalises them). Were this to fail, the template
    // changed: put it back and make templates/publication/2/, never move this hash. It moved once,
    // before anything was published: the document's title became a heading (it had been Typst's
    // `title()`, which a screen reader hears as a paragraph), so no publication names the old bytes.
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      'e8afabbac53bb797cfb024937ef4387834994a2d50062a029510d9ff300f58b0',
    );
    expect(PUBLICATION_TEMPLATE).toMatchObject({ name: 'publication', version: 1 });
  });
});
