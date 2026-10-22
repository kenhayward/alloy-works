import { describe, expect, it } from 'vitest';
import { blockIdentifierFrom } from '../content/model/identifier.js';
import {
  DEFAULT_IMPORT_LEVELS,
  importLevelsSchema,
  proposeImport,
  type ImportFlowItem,
} from './proposal.js';

let next = 0;
const options = {
  language: 'en',
  direction: 'ltr' as const,
  newIdentifier: () => {
    const bytes = new Uint8Array(16);
    new DataView(bytes.buffer).setUint32(12, (next += 1));
    return blockIdentifierFrom(bytes);
  },
};

const heading = (level: number, text: string): ImportFlowItem => ({
  kind: 'heading',
  level,
  style: `Heading ${level}`,
  text,
});
const para = (text: string): ImportFlowItem => ({
  kind: 'block',
  block: { type: 'paragraph', content: [{ type: 'text', value: text, marks: [] }] },
  source: text,
});
const texts = (blocks: readonly unknown[]) =>
  blocks.map((block) =>
    (block as { content: { value: string }[] }).content.map((each) => each.value).join(''),
  );

describe('proposeImport', () => {
  it('IMP-001 IMP-004 IMP-030 breaks a document out by its headings, a section per Heading 1 and a component per Heading 2, each with its reason', () => {
    const { parts } = proposeImport(
      [
        para('Before anything'),
        heading(1, 'Methods'),
        para('Under the section'),
        heading(2, 'Sampling'),
        para('How Ada sampled'),
        heading(3, 'Detail'),
        para('Deeper'),
        heading(2, 'Analysis'),
        para('How Grace analysed'),
        heading(1, 'Results'),
      ],
      DEFAULT_IMPORT_LEVELS,
      options,
    );
    expect(parts.map((part) => [part.kind, part.title, part.parent])).toEqual([
      ['component', 'Introduction', null],
      ['section', 'Methods', null],
      ['component', 'Methods', 1],
      ['component', 'Sampling', 1],
      ['component', 'Analysis', 1],
      ['section', 'Results', null],
    ]);
    expect(parts.map((part) => part.reason)).toEqual([
      { rule: 'beforeFirstHeading' },
      { rule: 'heading', style: 'Heading 1', text: 'Methods', level: 1 },
      { rule: 'beforeFirstComponent', style: 'Heading 1', text: 'Methods', level: 1 },
      { rule: 'heading', style: 'Heading 2', text: 'Sampling', level: 2 },
      { rule: 'heading', style: 'Heading 2', text: 'Analysis', level: 2 },
      { rule: 'heading', style: 'Heading 1', text: 'Results', level: 1 },
    ]);
    // A deeper heading stays in its component as a paragraph, and says so.
    expect(texts(parts[3]!.blocks)).toEqual(['How Ada sampled', 'Detail', 'Deeper']);
    expect(parts[3]!.report.map((entry) => entry.subject)).toContain('heading');
    expect(parts[3]!.source).toBe('Sampling\nHow Ada sampled\nDetail\nDeeper');
    expect(parts[5]!.blocks).toEqual([]);
  });

  it('IMP-004 proposes again at the levels the importer chooses', () => {
    const flow = [heading(1, 'Part one'), heading(2, 'Chapter'), heading(3, 'Topic'), para('Text')];
    const { parts } = proposeImport(flow, { section: 2, component: 3 }, options);
    expect(parts.map((part) => [part.kind, part.title, part.parent])).toEqual([
      ['section', 'Part one', null],
      ['section', 'Chapter', null],
      ['component', 'Topic', 1],
    ]);
  });

  it('IMP-017 admits each component as a paste is, so nothing proposed fails validation', () => {
    const { parts } = proposeImport(
      [
        heading(2, 'Linked'),
        {
          kind: 'block',
          block: {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                value: 'Click',
                marks: [{ type: 'hyperlink', href: 'javascript:alert(1)' }],
              },
            ],
          },
          source: 'Click',
        },
        heading(2, 'Broken'),
        { kind: 'block', block: { type: 'paragraph', content: 'not a list' }, source: '?' },
        heading(2, 'Nothing'),
      ],
      DEFAULT_IMPORT_LEVELS,
      options,
    );
    expect(parts[0]!.blocks).toHaveLength(1);
    expect(parts[0]!.report).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'discarded', subject: 'hyperlink' }),
      ]),
    );
    expect(parts[1]).toMatchObject({ blocks: [], flags: ['refused'] });
    expect(parts[2]).toMatchObject({ blocks: [], flags: ['empty'] });
  });

  it('takes levels a section above its components, and no other', () => {
    expect(importLevelsSchema.safeParse({ section: 1, component: 2 }).success).toBe(true);
    expect(importLevelsSchema.safeParse({ section: 2, component: 2 }).success).toBe(false);
    expect(importLevelsSchema.safeParse({ section: 0, component: 2 }).success).toBe(false);
    expect(importLevelsSchema.safeParse({ section: 1, component: 10 }).success).toBe(false);
  });
});
