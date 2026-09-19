import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  assemble,
  defaultLayout,
  DRAFT_NOTICE,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseOutlineDocument,
  PUBLISHING_SCHEMA,
  PUBLISHING_SCHEMA_1,
  type AssembleInput,
  type Layout,
} from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { loadPinnedFonts } from './fonts.js';
import { PIPELINE_VERSION } from './jobs/publish.js';
import { PUBLICATION_TEMPLATE, TEMPLATE_READING } from './template.js';

const positional = { numbered: true, matter: 'body', pageBreak: 'none', values: {} } as const;

describe('the publication template', () => {
  it('is the version its number says: an edit is a new version, never a change to this one', async () => {
    // Of each file with LF endings (.gitattributes normalises them). Were a row to fail, that template
    // changed: put it back and make the next directory, never move a published version's hash.
    // Template 1's moved once, before anything was published: the document's title became a heading
    // (it had been Typst's `title()`, which a screen reader hears as a paragraph), so no publication
    // names the old bytes. Template 2 is re-pinned freely until the pull request that makes it
    // merges, since nothing is published from a branch.
    const pinned: Record<number, string> = {
      1: 'e8afabbac53bb797cfb024937ef4387834994a2d50062a029510d9ff300f58b0',
      2: 'b02df4a5ec4f07a843d6538dd5e1402fdf035d67db9979bd95a2a44829f606c5',
    };
    const hashes: Record<number, string> = {};
    for (const template of Object.values(PUBLICATION_TEMPLATE)) {
      expect(template.name).toBe('publication');
      hashes[template.version] = createHash('sha256')
        .update(await readFile(template.file))
        .digest('hex');
    }
    // Every template the worker can compile with is pinned, and nothing pinned is missing.
    expect(hashes).toEqual(pinned);
  });

  it("is chosen by the schema of the document it reads: slice 1's for a request made before layouts", () => {
    expect(TEMPLATE_READING).toEqual({ [PUBLISHING_SCHEMA_1]: 1, [PUBLISHING_SCHEMA]: 2 });
  });
});

/**
 * One fixed input touching each part of `assemble` the published document carries: a section, a
 * reference inside it, a paragraph, and a component in another language than its document's - under
 * the layout given, or none, as a request made before layouts is assembled.
 */
const fixed = <Under extends Layout | null>(
  covers: (codePoint: number) => boolean,
  layout: Under,
): AssembleInput & { readonly layout: Under } => ({
  outline: parseOutlineDocument({
    schemaVersion: OUTLINE_SCHEMA_VERSION,
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
  layout,
  revision: '0.1',
  covers,
});

describe('the pipeline version', () => {
  // `assemble` and the draft notice it carries (`DRAFT_NOTICE` for slice 1, the layout's words since,
  // which the template's hash does not cover) decide what every publication says, so the record names
  // them by the pipeline version: each version, what it makes of this input. Never edit a row - a
  // change to either is a new pipeline version and a new row, and a publication made before still
  // names what made it. Both rows are reachable: '1' is what a request made before layouts publishes.
  const madeByPipeline: Record<string, string> = {
    '1': '3b844cb4ceedbe2b52040c79014ea18959295a1602754eb9861631891beb6fa1',
    '2': '699d5c34b7e4049fc32f5846a5525f5d3a35785c2858a78755161c58427ad1d5',
  };
  const digest = (made: { document: unknown; numbering: unknown }) =>
    createHash('sha256')
      .update(JSON.stringify({ document: made.document, numbering: made.numbering }))
      .digest('hex');

  it('is the version its number says: what assemble makes of a fixed input, the draft notice included', async () => {
    const assembled = assemble(fixed((await loadPinnedFonts()).covers, null));
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    expect(assembled.document.schema).toBe(PUBLISHING_SCHEMA_1);
    expect(PIPELINE_VERSION[assembled.document.schema]).toBe('1');
    expect(digest(assembled)).toBe(madeByPipeline[PIPELINE_VERSION[assembled.document.schema]]);
    expect(assembled.document.notice).toEqual(DRAFT_NOTICE);
    // The override reached the published document, so the pin covers the language path too.
    expect(assembled.document.nodes[0]?.children[0]?.language).toEqual({
      lang: 'de',
      region: 'DE',
    });
  });

  it('is the version its number says under a layout: what assemble makes of the fixed input under the default layout', async () => {
    const assembled = assemble(fixed((await loadPinnedFonts()).covers, defaultLayout));
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    expect(assembled.document.schema).toBe(PUBLISHING_SCHEMA);
    expect(PIPELINE_VERSION[assembled.document.schema]).toBe('2');
    expect(digest(assembled)).toBe(madeByPipeline[PIPELINE_VERSION[assembled.document.schema]]);
    expect(assembled.document.words).toMatchObject({
      notice: DRAFT_NOTICE.page,
      noticeSentence: DRAFT_NOTICE.text,
    });
    expect(assembled.document.nodes[0]?.children[0]?.language).toEqual({
      lang: 'de',
      region: 'DE',
    });
  });
});
