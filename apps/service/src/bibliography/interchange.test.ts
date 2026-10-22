import { plugins } from '@citation-js/core';
import { describe, expect, it } from 'vitest';

import { formatEntries, readRecords } from './interchange.js';

const bibtex = `@article{smith2020,
  author = {Smith, Ada and Okafor, Grace},
  title = {The Dunnart in Winter},
  journal = {Journal of Small Marsupials},
  year = {2020},
  volume = {12},
  pages = {1--20},
  doi = {10.1234/dunnart.2020}
}`;

const ris = ['TY  - BOOK', 'AU  - Jones, Grace', 'TI  - Quolls', 'PY  - 2019', 'ER  - ', ''].join(
  '\n',
);

describe('the interchange formats', () => {
  it('IMP-014 reads BibTeX, RIS and CSL-JSON as CSL records', () => {
    expect(readRecords('bibtex', bibtex)).toEqual([
      expect.objectContaining({
        type: 'article-journal',
        title: 'The Dunnart in Winter',
        author: [
          { given: 'Ada', family: 'Smith' },
          { given: 'Grace', family: 'Okafor' },
        ],
        issued: { 'date-parts': [[2020]] },
        page: '1-20',
        DOI: '10.1234/dunnart.2020',
      }),
    ]);
    expect(readRecords('ris', ris)).toEqual([
      expect.objectContaining({
        type: 'book',
        title: 'Quolls',
        author: [{ family: 'Jones', given: 'Grace' }],
      }),
    ]);
    expect(readRecords('csl-json', JSON.stringify({ type: 'book', title: 'Potoroos' }))).toEqual([
      { type: 'book', title: 'Potoroos' },
    ]);
    expect(
      readRecords('csl-json', '[{"type":"book","title":"A"},{"type":"book","title":"B"}]'),
    ).toHaveLength(2);
  });

  it('leaves citation-js nothing that reaches the network or a page', () => {
    const registered = plugins.input.list();
    for (const type of ['@else/url', '@else/jquery', '@else/html']) {
      expect(registered).not.toContain(type);
    }
  });

  it('refuses text that does not read as the format', () => {
    expect(readRecords('csl-json', '{not json')).toBeUndefined();
    expect(readRecords('csl-json', '"a string"')).toBeUndefined();
    expect(readRecords('bibtex', 'nothing here')).toBeUndefined();
    expect(readRecords('ris', 'nothing here')).toBeUndefined();
  });

  it('LIB-009 writes entries as CSL-JSON, BibTeX and RIS, each named by its key, and reads them back', () => {
    const entries = [
      {
        key: 'smith2020',
        csl: {
          type: 'article-journal' as const,
          title: 'The Dunnart in Winter',
          author: [{ family: 'Smith', given: 'Ada' }],
          issued: { 'date-parts': [[2020]] },
          DOI: '10.1234/dunnart.2020',
        },
      },
    ];
    const json = formatEntries('csl-json', entries);
    expect(JSON.parse(json)).toEqual([{ id: 'smith2020', ...entries[0]!.csl }]);
    const written = formatEntries('bibtex', entries);
    expect(written).toMatch(/^@article\{smith2020,/);
    expect(readRecords('bibtex', written)).toEqual([
      expect.objectContaining({ title: 'The Dunnart in Winter', DOI: '10.1234/dunnart.2020' }),
    ]);
    const risWritten = formatEntries('ris', entries);
    expect(risWritten).toMatch(/^TY {2}- JOUR/m);
    expect(risWritten).toMatch(/^ID {2}- smith2020/m);
    expect(readRecords('ris', risWritten)).toEqual([
      expect.objectContaining({ title: 'The Dunnart in Winter' }),
    ]);
  });
});
