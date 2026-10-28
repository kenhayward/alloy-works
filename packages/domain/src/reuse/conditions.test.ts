import { describe, expect, it } from 'vitest';

import type { ContentDocument } from '../content/model/document.js';
import {
  applyConditions,
  conditionAxisDefinitionSchema,
  wordsOf,
  profileSchema,
  type Profile,
} from './conditions.js';

const run = (value: string, ...conditions: [axis: string, values: string[]][]) => ({
  type: 'text' as const,
  value,
  marks: conditions.map(([axis, values], at) => ({
    type: 'condition' as const,
    id: `m${at + 1}`,
    axis,
    values,
  })),
});

const doc = (...content: ContentDocument['content']): ContentDocument => ({
  schemaVersion: 1,
  title: 'Site report',
  language: 'en-GB',
  direction: 'ltr',
  content,
});

const paragraph = (id: string, ...content: ReturnType<typeof run>[]) => ({
  type: 'paragraph' as const,
  id,
  style: 'body',
  content,
});

const textOf = (content: ContentDocument) =>
  content.content.map((block) =>
    block.type === 'paragraph'
      ? block.content.map((each) => (each.type === 'text' ? each.value : '')).join('')
      : block.type,
  );

describe('condition axes (the R6 plan, R6-A)', () => {
  it('REU-020 declares an axis by its key and its closed list of values', () => {
    const axis = conditionAxisDefinitionSchema.parse({
      schemaVersion: 1,
      id: '00000000-0000-4000-8000-00000000c001',
      name: 'Audience',
      key: 'audience',
      values: [
        { key: 'regulator', label: 'Regulator' },
        { key: 'internal', label: 'Internal' },
      ],
    });
    expect(axis.values.map((each) => each.key)).toEqual(['regulator', 'internal']);
    const refused = (values: unknown) =>
      conditionAxisDefinitionSchema.safeParse({
        schemaVersion: 1,
        id: '00000000-0000-4000-8000-00000000c001',
        name: 'Audience',
        key: 'audience',
        values,
      }).success;
    expect(refused([])).toBe(false);
    expect(
      refused([
        { key: 'internal', label: 'Internal' },
        { key: 'internal', label: 'Also internal' },
      ]),
    ).toBe(false);
  });

  it('REU-022 reads a profile as the values a document takes on each axis', () => {
    expect(profileSchema.parse({ audience: ['regulator'] })).toEqual({ audience: ['regulator'] });
    expect(profileSchema.safeParse({ audience: [] }).success).toBe(false);
  });
});

describe('applying conditions (the R6 plan, R6-C)', () => {
  const regulator: Profile = { audience: ['regulator'], region: ['uk'] };

  it('keeps a run only where every condition on it selects it, so ranges may overlap', () => {
    const applied = applyConditions(
      doc(
        paragraph(
          'p1',
          run('All readers. '),
          run('Regulator only. ', ['audience', ['regulator']]),
          run('Internal only. ', ['audience', ['internal']]),
          run('UK regulator. ', ['audience', ['regulator', 'internal']], ['region', ['uk']]),
          run('EU regulator.', ['audience', ['regulator']], ['region', ['eu']]),
        ),
      ),
      regulator,
    );
    expect(textOf(applied.content)).toEqual(['All readers. Regulator only. UK regulator. ']);
    // A kept run carries no condition: nothing after this stage names an axis.
    const [kept] = applied.content.content as unknown as [{ content: { marks: unknown[] }[] }];
    expect(kept.content.every((each) => each.marks.length === 0)).toBe(true);
    expect(applied.excluded).toEqual(['Internal only. ', 'EU regulator.']);
  });

  it("CNT-185 excludes every fragment of one condition, in runs and paragraphs apart, in the one profile's pass", () => {
    // One condition, its identifier the same on each fragment the editor split it into.
    const fragment = (value: string) => ({
      type: 'text' as const,
      value,
      marks: [{ type: 'condition' as const, id: 'c7', axis: 'audience', values: ['internal'] }],
    });
    const applied = applyConditions(
      doc(
        paragraph('p1', run('Open. '), fragment('Internal, '), run('open again. ')),
        paragraph('p2', fragment('still internal.'), run(' Open at last.')),
        paragraph('p3', fragment('Wholly internal.')),
      ),
      regulator,
    );
    expect(textOf(applied.content)).toEqual(['Open. open again. ', ' Open at last.']);
    expect(applied.excluded).toEqual(['Internal, ', 'still internal.', 'Wholly internal.']);
    expect(applied.removed).toEqual(['p3']);
  });

  it('REU-024 excludes what is conditioned on an axis the profile does not name, and says so', () => {
    const applied = applyConditions(
      doc(paragraph('p1', run('Kept. '), run('Draft note.', ['status', ['draft']]))),
      regulator,
    );
    expect(textOf(applied.content)).toEqual(['Kept. ']);
    expect(applied.unset).toEqual([{ axis: 'status', block: 'p1' }]);
  });

  it('reads only the axes the profile names, never a member every object inherits', () => {
    const applied = applyConditions(
      doc(paragraph('p1', run('Kept. '), run('Odd.', ['constructor', ['x']]))),
      regulator,
    );
    expect(textOf(applied.content)).toEqual(['Kept. ']);
    expect(applied.unset).toEqual([{ axis: 'constructor', block: 'p1' }]);
  });

  it('removes a paragraph its conditions empty, keeping one that was empty to begin with', () => {
    const applied = applyConditions(
      doc(
        paragraph('p1', run('Internal.', ['audience', ['internal']])),
        paragraph('p2'),
        paragraph('p3', run('For all.')),
      ),
      regulator,
    );
    expect(applied.content.content.map((block) => block.id)).toEqual(['p2', 'p3']);
  });

  it('reaches a paragraph inside a list item', () => {
    const applied = applyConditions(
      doc({
        type: 'list',
        id: 'l1',
        kind: 'unordered',
        items: [
          {
            content: [paragraph('i1', run('Item '), run('internal', ['audience', ['internal']]))],
          },
        ],
      }),
      regulator,
    );
    expect(JSON.stringify(applied.content)).not.toContain('internal');
    expect(applied.excluded).toEqual(['internal']);
  });

  describe('an index marker (the IX plan, IX-F)', () => {
    const marker = (term: string) => ({ type: 'indexMarker' as const, term });

    it('REU-048 drops a marker inside an excluded passage with the passage, and keeps one outside', () => {
      const applied = applyConditions(
        doc({
          type: 'paragraph',
          id: 'p1',
          style: 'body',
          content: [
            run('Open. '),
            marker('Kept term'),
            run('Internal ', ['audience', ['internal']]),
            marker('Hidden term'),
            run('only.', ['audience', ['internal']]),
            marker('Trailing term'),
            run(' Open again.'),
          ],
        }),
        regulator,
      );
      const printed = JSON.stringify(applied.content);
      expect(printed).toContain('Kept term');
      expect(printed).not.toContain('Hidden term');
      expect(printed).not.toContain('Trailing term');
      expect(applied.excluded).toEqual(['Internal only.']);
    });

    it('REU-048 removes a paragraph holding only an excluded passage and its marker', () => {
      const applied = applyConditions(
        doc(paragraph('p1', run('Open.')), {
          type: 'paragraph',
          id: 'p2',
          style: 'body',
          content: [run('Internal.', ['audience', ['internal']]), marker('Hidden term')],
        }),
        regulator,
      );
      expect(textOf(applied.content)).toEqual(['Open.']);
      expect(applied.removed).toEqual(['p2']);
    });

    it("REU-048 collects a marker's words, so the scan probes for them where its block is excluded", () => {
      expect(
        wordsOf([
          { type: 'text', value: 'Grain', marks: [] },
          { type: 'indexMarker', term: 'Alloy', sub: 'tempering', seeAlso: ['Steel', 'Iron'] },
          { type: 'indexMarker', term: 'Metal', see: 'Alloy' },
        ]),
      ).toBe('Grain Alloy tempering Steel Iron Metal Alloy');
    });
  });
});
