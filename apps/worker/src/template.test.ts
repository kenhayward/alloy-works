import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  assemble,
  defaultNumberingScheme,
  DRAFT_NOTICE,
  parseContentDocument,
  parseOutlineDocument,
  type AssembleInput,
} from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { loadPinnedFonts } from './fonts.js';
import { PIPELINE_VERSION } from './jobs/publish.js';
import { PUBLICATION_TEMPLATE } from './template.js';

const positional = { numbered: true, matter: 'body', pageBreak: 'none', values: {} } as const;

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

/**
 * One fixed input touching each part of `assemble` the published document carries: a section, a
 * reference inside it, a paragraph, and a component in another language than its document's.
 */
const fixed = (covers: (codePoint: number) => boolean): AssembleInput => ({
  outline: parseOutlineDocument({
    schemaVersion: 1,
    title: 'The dosing report',
    language: 'en-GB',
    direction: 'ltr',
    nodes: [
      {
        type: 'section',
        id: 'introduction'.padEnd(26, 'a'),
        title: [{ type: 'text', value: 'Introduction', marks: [] }],
        ...positional,
        children: [
          {
            type: 'reference',
            id: 'calibration'.padEnd(26, 'a'),
            component: '00000000-0000-4000-8000-000000000001',
            mode: { kind: 'latest' },
            ...positional,
            children: [],
          },
        ],
      },
    ],
  }),
  occurrences: new Map([
    [
      'calibration'.padEnd(26, 'a'),
      parseContentDocument({
        schemaVersion: 1,
        title: 'Calibration',
        language: 'de-DE',
        direction: 'ltr',
        content: [
          {
            type: 'paragraph',
            id: 'p1',
            style: 'body',
            content: [{ type: 'text', value: 'Set the tray.', marks: [] }],
          },
        ],
      }),
    ],
  ]),
  refused: [],
  scheme: defaultNumberingScheme,
  covers,
});

describe('the pipeline version', () => {
  it('is the version its number says: what assemble makes of a fixed input, the draft notice included', async () => {
    const assembled = assemble(fixed((await loadPinnedFonts()).covers));
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    // `assemble` and the draft notice it carries (`DRAFT_NOTICE`, whose words the template's hash
    // does not cover) decide what every publication says, so the record names them by the pipeline
    // version: each version, what it makes of this input. Never edit a row - a change to either is a
    // new pipeline version and a new row, and a publication made before still names what made it.
    const madeByPipeline: Record<string, string> = {
      '1': '3b844cb4ceedbe2b52040c79014ea18959295a1602754eb9861631891beb6fa1',
    };
    expect(
      createHash('sha256')
        .update(JSON.stringify({ document: assembled.document, numbering: assembled.numbering }))
        .digest('hex'),
    ).toBe(madeByPipeline[PIPELINE_VERSION]);
    expect(assembled.document.notice).toEqual(DRAFT_NOTICE);
    // The override reached the published document, so the pin covers the language path too.
    expect(assembled.document.nodes[0]?.children[0]?.language).toEqual({
      lang: 'de',
      region: 'DE',
    });
  });
});
