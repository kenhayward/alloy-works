import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../stored/canonical.js';
import { defaultNumberingScheme } from '../structure/scheme.js';
import { canonicaliseVersionContent } from '../version/substance.js';

import {
  defaultLayout,
  LAYOUT_SCHEMA_VERSION,
  parseLayout,
  readLayout,
  speaksFor,
  unsupportedFormats,
  type Layout,
} from './layout.js';
import { DRAFT_NOTICE } from './published.js';

/** A deep copy of the default, as plain JSON, for a test to change and hand to the parse. */
const copy = (): Layout => JSON.parse(JSON.stringify(defaultLayout)) as Layout;

const pdfOf = (layout: Layout) => layout.formats.pdf;

describe('a layout', () => {
  it('PUB-011 declares the scheme sections, figures, tables and equations are numbered by, and refuses a layout without one', () => {
    const { scheme } = parseLayout(defaultLayout);
    expect(scheme).toEqual(defaultNumberingScheme);
    expect(Object.keys(scheme.sequences)).toEqual(
      expect.arrayContaining(['section', 'figure', 'table', 'equation']),
    );

    const unschemed = copy();
    Reflect.deleteProperty(unschemed, 'scheme');
    expect(() => parseLayout(unschemed)).toThrow();

    const withoutFigures = copy();
    Reflect.deleteProperty(withoutFigures.scheme.sequences, 'figure');
    expect(() => parseLayout(withoutFigures)).toThrow(/figures/);
  });

  it('holds the default layout to its own schema', () => {
    const expected: Layout = {
      schemaVersion: 1,
      language: 'en',
      words: {
        contents: 'Contents',
        notice: DRAFT_NOTICE.page,
        noticeSentence: DRAFT_NOTICE.text,
      },
      scheme: defaultNumberingScheme,
      matter: { cover: true, contents: { depth: 3 }, appendices: { newPage: true } },
      formats: {
        pdf: {
          page: { width: 595.28, height: 841.89 },
          orientation: 'portrait',
          margins: { top: 72, bottom: 72, inside: 72, outside: 72 },
          gutter: 0,
          head: [[{ kind: 'field', field: 'title' }], [], [{ kind: 'field', field: 'section' }]],
          foot: [
            [
              { kind: 'words', text: 'Revision ' },
              { kind: 'field', field: 'revision' },
            ],
            [],
            [
              { kind: 'words', text: 'Page ' },
              { kind: 'field', field: 'page' },
            ],
          ],
          pageNumbering: {
            front: { format: 'lowerRoman', restart: true },
            body: { format: 'decimal', restart: true },
            appendix: { format: 'decimal', restart: false },
          },
        },
      },
    };
    expect(LAYOUT_SCHEMA_VERSION).toBe(1);
    expect(defaultLayout).toEqual(expected);
    expect(parseLayout(defaultLayout)).toEqual(expected);

    const read = readLayout(JSON.parse(JSON.stringify(defaultLayout)), {
      artifact: 'layout-artifact',
      version: 'layout-version',
    });
    expect(read).toEqual({ ok: true, layout: expected });
  });

  it('reports a stored layout it cannot read with its artifact and version, and yields nothing', () => {
    const newer = { ...copy(), schemaVersion: 2 };
    const read = readLayout(newer, { artifact: 'layout-artifact', version: 'layout-version' });
    expect(read).toMatchObject({
      ok: false,
      artifact: 'layout-artifact',
      version: 'layout-version',
    });
    expect(read.ok === false && read.failure).toMatch(/layout.*2/);
  });

  it('refuses every member it does not declare, at every depth', () => {
    const lists = { ...copy(), lists: [] };
    expect(() => parseLayout(lists)).toThrow();

    const docx = copy();
    Object.assign(docx.formats, { docx: {} });
    expect(() => parseLayout(docx)).toThrow();

    const paged = copy();
    Object.assign(pdfOf(paged), { paged: true });
    expect(() => parseLayout(paged)).toThrow();

    const colour = copy();
    Object.assign(pdfOf(colour).head[0][0]!, { colour: 'red' });
    expect(() => parseLayout(colour)).toThrow();
  });

  it('refuses words and labels that cannot be stored', () => {
    const nul = copy();
    nul.words.contents = 'Con\u{0}tents';
    expect(() => parseLayout(nul)).toThrow(/cannot be stored/);

    // A scheme other than the default's is named by an id of its own (preflight M3).
    const surrogate = copy();
    surrogate.scheme.id = 'unstorable/1';
    surrogate.scheme.sequences['figure']!.body.label = 'Figure\u{D800}';
    expect(() => parseLayout(surrogate)).toThrow(/cannot be stored/);
  });

  it('refuses a notice that says nothing, and words longer than a line can hold', () => {
    const blank = copy();
    blank.words.notice = '   ';
    expect(() => parseLayout(blank)).toThrow(/say something/);

    const empty = copy();
    pdfOf(empty).foot[0][0] = { kind: 'words', text: '' };
    expect(() => parseLayout(empty)).toThrow();

    const long = copy();
    pdfOf(long).foot[2][0] = { kind: 'words', text: 'x'.repeat(201) };
    expect(() => parseLayout(long)).toThrow();

    const crowded = copy();
    pdfOf(crowded).head[1] = Array.from({ length: 9 }, () => ({ kind: 'field', field: 'page' }));
    expect(() => parseLayout(crowded)).toThrow();
  });

  it('refuses a page that leaves less than an inch to set text in', () => {
    const narrow = copy();
    pdfOf(narrow).margins = { top: 72, bottom: 72, inside: 270, outside: 270 };
    expect(() => parseLayout(narrow)).toThrow(/an inch/);

    const landscape = copy();
    pdfOf(landscape).margins = { top: 72, bottom: 72, inside: 270, outside: 270 };
    pdfOf(landscape).orientation = 'landscape';
    expect(parseLayout(landscape).formats.pdf.orientation).toBe('landscape');

    const short = copy();
    pdfOf(short).margins = { top: 400, bottom: 400, inside: 72, outside: 72 };
    expect(() => parseLayout(short)).toThrow(/an inch/);

    const gutter = copy();
    pdfOf(gutter).margins = { top: 72, bottom: 72, inside: 230, outside: 230 };
    expect(parseLayout(gutter).formats.pdf.gutter).toBe(0);
    pdfOf(gutter).gutter = 64;
    expect(() => parseLayout(gutter)).toThrow(/an inch/);
  });

  it('refuses a page given in landscape sense, and a gutter or margin below nothing', () => {
    // Landscape is the orientation's to say, never swapped dimensions (preflight I6).
    const swapped = copy();
    pdfOf(swapped).page = { width: 841.89, height: 595.28 };
    expect(() => parseLayout(swapped)).toThrow(/portrait sense/);

    const square = copy();
    pdfOf(square).page = { width: 600, height: 600 };
    expect(parseLayout(square).formats.pdf.page).toEqual({ width: 600, height: 600 });

    const negativeGutter = copy();
    pdfOf(negativeGutter).gutter = -1;
    expect(() => parseLayout(negativeGutter)).toThrow();

    const negativeMargin = copy();
    pdfOf(negativeMargin).margins.top = -1;
    expect(() => parseLayout(negativeMargin)).toThrow();

    const tiny = copy();
    pdfOf(tiny).page = { width: 71, height: 841.89 };
    expect(() => parseLayout(tiny)).toThrow();

    const huge = copy();
    pdfOf(huge).page = { width: 595.28, height: 14401 };
    expect(() => parseLayout(huge)).toThrow();
  });

  it('refuses a language the engine cannot carry', () => {
    const script = copy();
    script.language = 'sr-Latn';
    expect(() => parseLayout(script)).toThrow(/sr-Latn/);

    const region = copy();
    region.language = 'en-GB';
    expect(parseLayout(region).language).toBe('en-GB');
  });

  it('matches a document to its layout by language range', () => {
    expect(speaksFor('en', 'en-GB')).toBe(true);
    expect(speaksFor('en', 'EN')).toBe(true);
    expect(speaksFor('sr-Latn', 'sr-Latn-RS')).toBe(true);
    expect(speaksFor('en', 'fr')).toBe(false);
    expect(speaksFor('en-GB', 'en')).toBe(false);
    expect(speaksFor('sr-Latn', 'sr-Cyrl')).toBe(false);
    expect(speaksFor('en', 'eng')).toBe(false);
  });

  it('names the formats a layout does not make', () => {
    expect(unsupportedFormats(defaultLayout, ['pdf', 'docx'])).toEqual(['docx']);
    expect(unsupportedFormats(defaultLayout, ['pdf'])).toEqual([]);
    expect(unsupportedFormats(defaultLayout, ['toString', 'docx', 'docx'])).toEqual([
      'toString',
      'docx',
    ]);
  });

  it("digests a layout version's content as canonical JSON", () => {
    expect(canonicaliseVersionContent({ kind: 'layout', content: defaultLayout })).toBe(
      canonicalJson(defaultLayout),
    );
  });
});
