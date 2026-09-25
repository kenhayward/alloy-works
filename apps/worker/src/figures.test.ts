import { createHash } from 'node:crypto';
import {
  assemble,
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseLayout,
  parseOutlineDocument,
  PUBLISHING_SCHEMA,
  type AssembleInput,
  type ContentDocument,
  type PublishingAsset,
} from '@alloy-works/domain';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { loadPinnedFonts } from './fonts.js';
import { rootImages } from './jobs/publish.js';
import { PUBLICATION_TEMPLATE, TEMPLATE_READING } from './template.js';
import { readPdf, type ReadPdf } from './testing/pdf.js';
import { defaultTheme } from './testing/theme.js';
import { checkPdfUa1 } from './testing/verapdf.js';
import { createTypst, typstBinaryPath } from './typst.js';

const fonts = await loadPinnedFonts();
const typst = createTypst({ binary: typstBinaryPath(), fonts });
const at = new Date('2026-09-23T00:00:00Z');
const id = (name: string) => name.padEnd(26, 'a');
const COMPONENT = '00000000-0000-4000-8000-000000000001';

/** No cover and no contents, but the default layout's list of figures, which opens the document. */
const listed = parseLayout({
  ...defaultLayout,
  matter: { ...defaultLayout.matter, cover: false, contents: null },
});

/** An image made here, with the facts a request would hand the job for it. */
const imageOf = async (
  version: string,
  size: { width: number; height: number },
  format: 'png' | 'jpeg',
  alternative: PublishingAsset['alternative'],
) => {
  const made = sharp({
    create: { ...size, channels: 3, background: { r: 200, g: 30, b: 30 } },
  });
  const bytes = await (format === 'png' ? made.png() : made.jpeg()).toBuffer();
  const hash = createHash('sha256').update(bytes).digest('hex');
  const asset: PublishingAsset = {
    object: `t_acme/sha256/${hash}`,
    format,
    ...size,
    alternative,
  };
  return { version, bytes, asset };
};

const RED = '00000000-0000-4000-8000-00000000a551';
const GERMAN = '00000000-0000-4000-8000-00000000de00';
const TALL = '00000000-0000-4000-8000-0000000074a1';

const figure = (name: string, asset: string, alternative: object, caption: string) => ({
  type: 'figure',
  id: name,
  asset,
  imageStyle: 'figure',
  caption: [{ type: 'text', value: caption, marks: [] }],
  alternative,
});

/**
 * The regression case (figures 3): a figure with its own text, one inheriting its image's text in
 * another language than the component's, a decorative one, and one so tall that at the full measure
 * it would run off its page - which the engine allows and says nothing about.
 */
const content = [
  figure('f1', RED, { kind: 'own', text: 'Two red squares' }, 'Our shapes'),
  figure('f2', GERMAN, { kind: 'inherited' }, 'Their shapes'),
  figure('f3', RED, { kind: 'decorative' }, 'A border'),
  figure('f4', TALL, { kind: 'inherited' }, 'A tall one'),
];

const inputOf = (
  assets: ReadonlyMap<string, PublishingAsset>,
  blocks: readonly unknown[] = content,
): AssembleInput => ({
  formats: ['pdf'],
  outline: parseOutlineDocument({
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: 'The shapes',
    language: 'en-GB',
    direction: 'ltr',
    nodes: [
      {
        type: 'reference',
        id: id('shapes'),
        component: COMPONENT,
        mode: { kind: 'latest' },
        numbered: true,
        matter: 'body',
        pageBreak: 'none',
        values: {},
        children: [],
      },
    ],
  }),
  occurrences: new Map([
    [
      id('shapes'),
      parseContentDocument({
        schemaVersion: 1,
        title: 'Shapes',
        language: 'en-GB',
        direction: 'ltr',
        content: blocks,
      }) as ContentDocument,
    ],
  ]),
  refused: [],
  layout: listed,
  theme: defaultTheme,
  revision: '0.1',
  covers: fonts.covers,
  assets,
});

describe('a figure in the PDF (figures 3)', () => {
  let pdf: Buffer;
  let read: ReadPdf;

  const published = async () => {
    const images = [
      await imageOf(RED, { width: 800, height: 600 }, 'png', null),
      await imageOf(GERMAN, { width: 600, height: 400 }, 'jpeg', {
        text: 'Zwei Formen',
        language: 'de',
      }),
      await imageOf(TALL, { width: 500, height: 2000 }, 'png', {
        text: 'A tall shape',
        language: 'en-GB',
      }),
    ];
    const assets = new Map(images.map((each) => [each.version, each.asset]));
    const assembled = assemble(inputOf(assets));
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    const stored = new Map(images.map((each) => [each.asset.object, each.bytes]));
    return typst.compile(
      PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file,
      JSON.stringify(assembled.document),
      at,
      // The job's own function, over a store that is a map: the images are placed as a job places them.
      await rootImages(assets, async (key) => stored.get(key)!),
    );
  };

  it('AST-015 AST-039 tags each figure with its text in its own language, and a decorative one not at all, and passes veraPDF', async () => {
    pdf = await published();
    read = await readPdf(pdf);
    expect(await checkPdfUa1(pdf)).toMatchObject({ compliant: true, failedRules: 0 });

    // Three `Figure`s for the three described figures, in order; the decorative image is an artifact
    // and is no `Figure` at all (AST-015), while its caption stays. The German text carries its own
    // language (AST-039); the others are in the component's, which the engine does not repeat.
    expect(read.figures.map(({ alt, lang }) => ({ alt, lang }))).toEqual([
      { alt: 'Two red squares', lang: null },
      { alt: 'Zwei Formen', lang: 'de' },
      { alt: 'A tall shape', lang: null },
    ]);
    expect(read.elements).toMatchObject({ Figure: 3, Caption: 4 });
    const said = read.taggedText.flat().join(' ');
    // Each caption below its image, numbered, the decorative figure's among them (decision F-M).
    for (const caption of [
      'Figure 1.1 Our shapes',
      'Figure 1.2 Their shapes',
      'Figure 1.3 A border',
      'Figure 1.4 A tall one',
    ]) {
      expect(said.replace(/\s+/g, ' ')).toContain(caption);
    }
  });

  it('keeps every image inside the text block of its page, however tall it is', () => {
    // The default page: A4, with an inch of margin all round.
    const [width, height] = [595.28, 841.89];
    for (const figure of read.figures) {
      const [left, bottom, right, top] = figure.box!;
      expect(left).toBeGreaterThanOrEqual(72 - 0.5);
      expect(right).toBeLessThanOrEqual(width - 72 + 0.5);
      expect(bottom).toBeGreaterThanOrEqual(72 - 0.5);
      expect(top).toBeLessThanOrEqual(height - 72 + 0.5);
    }
    // The tall one, held to sixty per cent of the text block's height.
    const [, bottom, , top] = read.figures[2]!.box!;
    expect(top - bottom).toBeCloseTo(418.73, 0);
  });

  it('lists every figure after the contents, the decorative one too, each entry linked to it', () => {
    // No contents and no table: the list of figures is the only table of contents in the file.
    expect(read.elements).toMatchObject({ TOC: 1, TOCI: 4 });
    // On a page of its own, after the title and the notice that open a document with no cover.
    const pages = read.taggedText.map((page) => page.join(' ').replace(/\s+/g, ' '));
    const list = pages.findIndex((page) => page.includes('Figures'));
    expect(list).toBeGreaterThanOrEqual(0);
    for (const entry of ['Figure 1.1 Our shapes', 'Figure 1.3 A border', 'Figure 1.4 A tall one']) {
      expect(pages[list]).toContain(entry);
    }
  });

  it('keeps a long caption on the page with its image, making the image smaller, and refuses one too long for any', async () => {
    // Found by the final review: a figure does not break - and made breakable, the engine writes no
    // layout box on its `Figure` - so a caption longer than the room below its image ran under the
    // running foot and off the page. `assemble` now leaves the caption room.
    const tall = await imageOf(TALL, { width: 200, height: 2000 }, 'png', {
      text: 'A tall shape',
      language: 'en-GB',
    });
    const caption = (count: number) =>
      Array.from({ length: count }, (_, at) => `word${at}`).join(' ');
    const assets = new Map([[tall.version, tall.asset]]);
    const refused = assemble(
      inputOf(assets, [figure('f1', TALL, { kind: 'inherited' }, caption(400))]),
    );
    expect(refused.ok === false && refused.failures.map((each) => each.code)).toEqual([
      'caption_too_long',
    ]);
    const assembled = assemble(
      inputOf(assets, [figure('f1', TALL, { kind: 'inherited' }, caption(240))]),
    );
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    const long = await typst.compile(
      PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file,
      JSON.stringify(assembled.document),
      at,
      await rootImages(assets, async () => tall.bytes),
    );
    const readLong = await readPdf(long);
    expect(await checkPdfUa1(long)).toMatchObject({ compliant: true, failedRules: 0 });
    // Every word is set, the last included, and no line of it stands in the bottom margin.
    expect(readLong.taggedText.flat().join(' ')).toContain('word239');
    for (const item of readLong.items) {
      expect(item.y, item.text).toBeGreaterThanOrEqual(72 - 0.5);
    }
  });
});

describe('an image in a line of text in the PDF (figures 5)', () => {
  const LOGO = '00000000-0000-4000-8000-0000000010c0';
  const FLAG = '00000000-0000-4000-8000-00000000f1a6';
  const inline = (asset: string, alternative: object) => ({
    type: 'image',
    asset,
    imageStyle: 'inline',
    alternative,
  });
  const words = (value: string) => ({ type: 'text', value, marks: [] });

  it('CNT-086 CNT-087 sets an image in a paragraph and in a table cell, each tagged where it stands, and passes veraPDF', async () => {
    const images = [
      await imageOf(LOGO, { width: 80, height: 60 }, 'png', {
        text: 'The printer logo',
        language: 'en-GB',
      }),
      await imageOf(FLAG, { width: 60, height: 40 }, 'jpeg', {
        text: 'Deutsche Flagge',
        language: 'de',
      }),
    ];
    const assets = new Map(images.map((each) => [each.version, each.asset]));
    const stored = new Map(images.map((each) => [each.asset.object, each.bytes]));
    const assembled = assemble(
      inputOf(assets, [
        {
          type: 'paragraph',
          id: 'p1',
          style: 'body',
          content: [
            words('Press '),
            inline(LOGO, { kind: 'inherited' }),
            words(' to start, then '),
            inline(LOGO, { kind: 'decorative' }),
            words(' again.'),
          ],
        },
        {
          type: 'table',
          id: 't1',
          style: 'table',
          caption: [words('Flags')],
          headerRows: 0,
          headerColumns: 0,
          rows: [
            {
              cells: [
                {
                  content: [
                    {
                      type: 'paragraph',
                      id: 'c1',
                      style: 'body',
                      content: [inline(FLAG, { kind: 'inherited' })],
                    },
                  ],
                  colspan: 1,
                  rowspan: 1,
                },
                {
                  content: [
                    { type: 'paragraph', id: 'c2', style: 'body', content: [words('Germany')] },
                  ],
                  colspan: 1,
                  rowspan: 1,
                },
              ],
            },
          ],
        },
      ]),
    );
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    const pdf = await typst.compile(
      PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file,
      JSON.stringify(assembled.document),
      at,
      await rootImages(assets, async (key) => stored.get(key)!),
    );
    expect(await checkPdfUa1(pdf)).toMatchObject({ compliant: true, failedRules: 0 });
    const read = await readPdf(pdf);
    // Two `Figure`s: the described image in its paragraph, and the flag in its cell, read in German -
    // which the engine declares on the table's row rather than on the `Figure` itself. The decorative
    // one is an artifact, no `Figure` at all.
    expect(read.figures.map(({ alt, spoken, parent }) => ({ alt, spoken, parent }))).toEqual([
      { alt: 'The printer logo', spoken: null, parent: 'P' },
      { alt: 'Deutsche Flagge', spoken: 'de', parent: 'P' },
    ]);
    // The flag's paragraph stands in the table's data cell.
    expect(read.elements).toMatchObject({ Figure: 2, TD: 2 });
    // The text either side of an image reads on, in order. Compared without its spaces: the extraction
    // drops the space at the edge of each run an image breaks, which the page itself still sets.
    expect(read.taggedText.flat().join('').replace(/\s+/g, '')).toContain(
      'Presstostart,thenagain.',
    );
    // One line high: 1.2 ems of the 11-point body.
    for (const figure of read.figures) {
      const [, bottom, , top] = figure.box!;
      expect(top - bottom).toBeCloseTo(13.2, 0);
    }
  });
});
