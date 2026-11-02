import { describe, expect, it } from 'vitest';

import { DEFAULT_CATALOGUES } from './default.js';
import { CATALOGUE_DOCUMENT_FORMAT, exportCatalogue, readCatalogueDocument } from './document.js';
import { readCatalogue } from './read.js';

/** A document as it travels: written out as text and read back in. */
const travelled = (document: unknown) => JSON.parse(JSON.stringify(document)) as unknown;

describe('a catalogue exported and imported (the SY plan, SY-I)', () => {
  it('STY-043 STY-073 exports each catalogue as a document naming its format and version, and re-imports it as an equivalent catalogue', () => {
    for (const catalogue of Object.values(DEFAULT_CATALOGUES)) {
      const document = exportCatalogue(catalogue);
      expect(document).toMatchObject({ format: CATALOGUE_DOCUMENT_FORMAT, version: 1 });
      // Equivalent: it reads as the catalogue itself reads, at the schema of today.
      expect(readCatalogueDocument(travelled(document))).toEqual(readCatalogue(catalogue));
    }
  });

  it('STY-044 reports everything an import cannot represent, each by where it is, rather than dropping it', () => {
    const paragraph = structuredClone(DEFAULT_CATALOGUES.paragraph) as unknown as {
      base: Record<string, unknown>;
      styles: Record<string, unknown>[];
    };
    paragraph.base['kerning'] = true;
    paragraph.styles[1]!['shadow'] = '#cccccc';
    const outcome = readCatalogueDocument(
      travelled({ ...exportCatalogue(DEFAULT_CATALOGUES.paragraph), catalogue: paragraph }),
    );
    expect(outcome.ok).toBe(false);
    const messages = outcome.ok ? [] : outcome.refusals.map((each) => each.message);
    expect(messages).toHaveLength(2);
    expect(messages.some((each) => each.includes('base') && each.includes('kerning'))).toBe(true);
    expect(messages.some((each) => each.includes('styles.1') && each.includes('shadow'))).toBe(
      true,
    );

    expect(readCatalogueDocument({ format: 'something-else', catalogue: {} })).toEqual({
      ok: false,
      refusals: [
        {
          code: 'catalogue_malformed',
          message: 'The document is not an Alloy Works catalogue: it names no format of ours',
        },
      ],
    });
    expect(
      readCatalogueDocument({ format: CATALOGUE_DOCUMENT_FORMAT, version: 2, catalogue: {} }),
    ).toEqual({
      ok: false,
      refusals: [
        {
          code: 'catalogue_malformed',
          message: 'The document is a catalogue at version 2, and this reads version 1',
        },
      ],
    });
  });
});
