import { createHash } from 'node:crypto';
import {
  assemble,
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseOutlineDocument,
  publishedImagePath,
  writeHtml,
  type ContentDocument,
  type PublishingAsset,
} from '@alloy-works/domain';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { loadPinnedFonts, pinnedFacesByHash } from './fonts.js';
import { leakedFrom } from './scan.js';
import { loadSubsetter } from './subset.js';
import { defaultTheme } from './testing/theme.js';

const fonts = await loadPinnedFonts();
const faces = await pinnedFacesByHash(fonts.directory);
const subset = await loadSubsetter();
const id = (name: string) => name.padEnd(26, 'a');
const RED = '00000000-0000-4000-8000-00000000a551';
const text = (value: string) => ({ type: 'text', value, marks: [] });
const paragraph = (name: string, ...content: unknown[]) => ({
  type: 'paragraph',
  id: name,
  style: 'body',
  content,
});

/** One component of these blocks, in the default theme and layout, as HTML from the pinned faces. */
async function published(blocks: readonly unknown[]) {
  const bytes = await sharp({
    create: { width: 80, height: 60, channels: 3, background: { r: 200, g: 30, b: 30 } },
  })
    .png()
    .toBuffer();
  const asset: PublishingAsset = {
    object: `t_acme/sha256/${createHash('sha256').update(bytes).digest('hex')}`,
    format: 'png',
    width: 80,
    height: 60,
    alternative: { text: 'Two red squares', language: 'en-GB' },
  };
  const assembled = assemble({
    formats: ['html'],
    outline: parseOutlineDocument({
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      title: 'The shapes',
      language: 'en-GB',
      direction: 'ltr',
      nodes: [
        {
          type: 'reference',
          id: id('shapes'),
          component: '00000000-0000-4000-8000-000000000001',
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
    layout: defaultLayout,
    theme: defaultTheme,
    revision: '0.1',
    covers: fonts.covers,
    assets: new Map([[RED, asset]]),
  });
  if (!assembled.ok || assembled.html === null) throw new Error(JSON.stringify(assembled));
  const written = writeHtml({
    document: assembled.document,
    html: assembled.html,
    faces,
    images: new Map([[publishedImagePath(asset), bytes]]),
    subset,
  });
  if (!written.ok) throw new Error(JSON.stringify(written.failures));
  return { bytes: written.bytes, html: new TextDecoder().decode(written.bytes) };
}

describe('an HTML publication from the pinned faces (the HT plan, HTb)', () => {
  it('writes a figure, an image in a line, a list and a quotation, the image its own bytes and its faces subset', async () => {
    const { html } = await published([
      {
        type: 'figure',
        id: 'f1',
        asset: RED,
        imageStyle: 'figure',
        caption: [text('Our shapes')],
        alternative: { kind: 'inherited' },
      },
      paragraph(
        'p1',
        text('Press '),
        { type: 'image', asset: RED, imageStyle: 'inline', alternative: { kind: 'inherited' } },
        text(' to start.'),
      ),
      {
        type: 'list',
        id: 'l1',
        kind: 'ordered',
        items: [{ content: [paragraph('l1a', text('Warm the tray.'))] }],
      },
      {
        type: 'blockquote',
        id: 'q1',
        content: [paragraph('q1a', text('Measure twice.'))],
        attribution: [text('Grace')],
      },
    ]);
    expect(html.match(/<img src="data:image\/png;base64,/g)).toHaveLength(2);
    expect(html).toContain('alt="Two red squares"');
    expect(html).toContain('Figure 1.1 Our shapes');
    // The serif embedded, subset by HarfBuzz, and the Naskh, which nothing falls to, not at all.
    expect(html).toContain('font-family: "aw-face-serif"; src: url("data:font/ttf;base64,');
    expect(html).not.toContain('aw-face-naskh"; src');
    expect(html.length).toBeLessThan(400_000);
  });

  it("REU-048 finds an excluded passage in an HTML image's alternative text", async () => {
    const { bytes } = await published([
      {
        type: 'figure',
        id: 'f1',
        asset: RED,
        imageStyle: 'figure',
        caption: [text('Our shapes')],
        alternative: { kind: 'own', text: 'Staff are told at noon' },
      },
    ]);
    expect(await leakedFrom(['staff are told at'], 'html', bytes)).toEqual(['staff are told at']);
  });
});
