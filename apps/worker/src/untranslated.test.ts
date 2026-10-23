import {
  assemble,
  defaultLayout,
  layoutIn,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseLayout,
  parseOutlineDocument,
  PUBLISHING_SCHEMA,
  readTheme,
  DEFAULT_CATALOGUES_BY_VERSION,
  DEFAULT_THEME,
} from '@alloy-works/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPinnedFonts } from './fonts.js';
import { PUBLICATION_TEMPLATE, TEMPLATE_READING } from './template.js';
import { readPdf, type ReadPdf } from './testing/pdf.js';
import { checkPdfUa1 } from './testing/verapdf.js';
import { createTypst, typstBinaryPath } from './typst.js';

/**
 * **A component published in its source language, in the PDF** (the TR plan, TRb): template 25 says
 * so under its heading in the document's language, and its own words keep their own.
 */

const fonts = await loadPinnedFonts();
const typst = createTypst({ binary: typstBinaryPath(), fonts, timeoutMs: 120_000 });
const METHODS = 'methods'.padEnd(26, 'a');
const RESULTS = 'results'.padEnd(26, 'a');
const theme = (() => {
  const read = readTheme(DEFAULT_THEME, DEFAULT_CATALOGUES_BY_VERSION);
  if (!read.ok) throw new Error(read.refusals.map((each) => each.message).join('\n'));
  return read.theme;
})();
const reference = (id: string) => ({
  type: 'reference',
  id,
  component: '00000000-0000-4000-8000-000000000001',
  mode: { kind: 'latest' },
  numbered: true,
  matter: 'body',
  pageBreak: 'none',
  values: {},
  children: [],
});
const component = (title: string, language: string, words: string) =>
  parseContentDocument({
    schemaVersion: 1,
    title,
    language,
    direction: 'ltr',
    content: [
      {
        type: 'paragraph',
        id: 'p1',
        style: 'body',
        content: [{ type: 'text', value: words, marks: [] }],
      },
    ],
  });

const compile = async () => {
  const french = layoutIn(defaultLayout, 'fr-FR')!;
  const made = assemble({
    formats: ['pdf'],
    outline: parseOutlineDocument({
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      title: 'Étude des étangs',
      language: 'fr-FR',
      direction: 'ltr',
      nodes: [reference(METHODS), reference(RESULTS)],
    }),
    occurrences: new Map([
      [METHODS, component('Méthodes', 'fr-FR', 'Les étangs ont été échantillonnés.')],
      [RESULTS, component('Results', 'en-GB', 'Twelve ponds held newts.')],
    ]),
    untranslated: new Map([[RESULTS, 'Non traduit (en-GB)']]),
    refused: [],
    layout: parseLayout({
      ...french,
      matter: { ...french.matter, cover: false, contents: null, lists: [] },
    }),
    theme,
    revision: '0.1',
    covers: fonts.covers,
    assets: new Map(),
  });
  if (!made.ok) throw new Error(JSON.stringify(made.failures));
  const template = PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file;
  return typst.compile(template, JSON.stringify(made.document), new Date('2026-10-23T00:00:00Z'));
};

describe('a component published in its source language, in the PDF (TRb)', () => {
  let pdf: Buffer;
  let read: ReadPdf;
  beforeAll(async () => {
    pdf = await compile();
    read = await readPdf(pdf);
  }, 120_000);

  it('PUB-103 passes the PDF/UA-1 profile with a component marked untranslated', async () => {
    expect(await checkPdfUa1(pdf)).toMatchObject({ compliant: true, failedRules: 0 });
  }, 120_000);

  it('LOC-037 says so under its heading, before its words, and of no other component', () => {
    const tagged = read.taggedText.flat().join(' ');
    expect(tagged).toMatch(/Results.*Non traduit \(en-GB\).*Twelve ponds held newts\./);
    expect(tagged.match(/Non traduit/g)).toHaveLength(1);
    expect(tagged).toMatch(/Méthodes.*Les étangs ont été échantillonnés\./);
  });

  it('LOC-037 keeps the fallen-back words in their own language, and the mark in the document’s', () => {
    const said = (words: string) =>
      read.reading.find((each) => each.role === 'P' && each.text === words);
    expect(said('Twelve ponds held newts.')?.lang).toBe('en-GB');
    expect(said('Non traduit (en-GB)')?.lang).toBeUndefined();
    expect(said('Les étangs ont été échantillonnés.')?.lang).toBeUndefined();
    expect(read.language).toBe('fr-FR');
  });
});
