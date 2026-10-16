import { describe, expect, it } from 'vitest';

import { applyOutlineOperation } from '../structure/operations.js';
import {
  canonicaliseOutline,
  OUTLINE_SCHEMA_VERSION,
  parseOutlineDocument,
  type OutlineDocument,
} from '../structure/outline.js';
import { parseContentDocument } from '../content/model/document.js';
import { conditions, number, resolve, sectionNumbers } from '../structure/numbering.js';
import { defaultNumberingScheme } from '../structure/scheme.js';
import { selectOutline, unsetAxes } from './conditions.js';

const COMPONENT = '5e1d0c7a-0b1f-4c1e-9a52-3f6d7c2b9e01';
const id = (name: string) => name.padEnd(26, 'a');
const text = (value: string) => ({ type: 'text' as const, value, marks: [] });
const positional = { numbered: true, matter: 'body', pageBreak: 'none', values: {} };
const section = (name: string, title: string, children: unknown[] = [], over: object = {}) => ({
  type: 'section',
  id: id(name),
  title: [text(title)],
  ...positional,
  children,
  ...over,
});
const reference = (name: string, over: object = {}) => ({
  type: 'reference',
  id: id(name),
  component: COMPONENT,
  mode: { kind: 'latest' },
  ...positional,
  children: [],
  ...over,
});
const outline = (nodes: unknown[]): OutlineDocument =>
  parseOutlineDocument({
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: 'The dosing report',
    language: 'en-GB',
    direction: 'ltr',
    nodes,
  });
const next = () => {
  throw new Error('A set makes no node');
};
const regulator = [{ axis: 'audience', values: ['regulator'] }];

describe('conditions on an outline node (the R11 plan, R11-A)', () => {
  it('REU-021 marks a section or a component reference with conditions, held in the outline and its digest', () => {
    const marked = outline([
      section('annex', 'Regulatory annex', [], { conditions: regulator }),
      reference('calib', { conditions: regulator }),
    ]);
    expect(marked.nodes.map((node) => node.conditions)).toEqual([regulator, regulator]);
    expect(canonicaliseOutline(marked)).not.toBe(
      canonicaliseOutline(outline([section('annex', 'Regulatory annex'), reference('calib')])),
    );
    // None is no member, never an empty list; an axis or a value no key could be is refused.
    for (const conditions of [
      [],
      [{ axis: 'audience', values: [] }],
      [{ axis: 'Audience', values: ['regulator'] }],
    ]) {
      expect(() => outline([section('annex', 'Annex', [], { conditions })])).toThrow();
    }
  });

  it('REU-021 sets a node conditions whole through the outline, and clears them with none', () => {
    const plain = outline([section('annex', 'Regulatory annex'), reference('calib')]);
    const set = applyOutlineOperation(
      plain,
      {
        operation: 'set',
        node: id('calib'),
        conditions: regulator,
      },
      next,
    );
    if (!set.applied) throw new Error(set.reason);
    expect(set.outline.nodes[1]).toMatchObject({ conditions: regulator });
    const cleared = applyOutlineOperation(
      set.outline,
      {
        operation: 'set',
        node: id('calib'),
        conditions: [],
      },
      next,
    );
    if (!cleared.applied) throw new Error(cleared.reason);
    expect(cleared.outline.nodes[1]).not.toHaveProperty('conditions');
    expect(canonicaliseOutline(cleared.outline)).toBe(canonicaliseOutline(plain));
  });

  it('REU-024 keeps a node its conditions select, takes out one they do not with everything under it, and reports an axis the profile does not name', () => {
    const marked = outline([
      section('intro', 'Introduction', [reference('calib')]),
      section('annex', 'Regulatory annex', [section('detail', 'Detail', [reference('deep')])], {
        conditions: regulator,
      }),
      reference('draft', { conditions: [{ axis: 'status', values: ['draft'] }] }),
    ]);
    const forStaff = selectOutline(marked, { audience: ['internal'] });
    expect(forStaff.outline.nodes.map((node) => node.id)).toEqual([id('intro')]);
    expect(forStaff.excluded).toEqual([id('annex'), id('detail'), id('deep'), id('draft')]);
    // Every title taken out, for the scan (REU-048).
    expect(forStaff.passages).toEqual(['Regulatory annex', 'Detail']);
    expect(forStaff.unset).toEqual([{ axis: 'status', node: id('draft') }]);

    const forRegulator = selectOutline(marked, { audience: ['regulator'], status: ['final'] });
    expect(forRegulator.outline.nodes.map((node) => node.id)).toEqual([id('intro'), id('annex')]);
    expect(forRegulator.excluded).toEqual([id('draft')]);
    expect(forRegulator.unset).toEqual([]);
    // What a profile keeps is returned without its conditions, which nothing downstream reads.
    expect(forRegulator.outline.nodes[1]).not.toHaveProperty('conditions');
  });
});

describe('whether a profile is complete (the R11 plan, R11-G)', () => {
  it('names each axis the kept outline and content are conditioned on that the profile does not set, once', () => {
    const marked = outline([
      section('annex', 'Annex', [reference('calib')], {
        conditions: [{ axis: 'market', values: ['uk'] }],
      }),
      reference('notice'),
    ]);
    const conditioned = parseContentDocument({
      schemaVersion: 1,
      title: 'Notice',
      language: 'en-GB',
      direction: 'ltr',
      content: [
        {
          type: 'paragraph',
          id: 'p1',
          style: 'body',
          content: [
            {
              type: 'text',
              value: 'For vets.',
              marks: [{ type: 'condition', id: 'c1', axis: 'audience', values: ['vets'] }],
            },
          ],
        },
      ],
    });
    const contents = new Map([
      [id('calib'), conditioned],
      [id('notice'), conditioned],
    ]);
    expect(unsetAxes(marked, contents, {})).toEqual(['audience', 'market']);
    // What the profile leaves out asks nothing of it.
    expect(unsetAxes(marked, contents, { market: ['us'] })).toEqual(['audience']);
    expect(unsetAxes(marked, contents, { market: ['us'], audience: ['vets'] })).toEqual([]);
  });
});

describe('numbering as it will publish (the R11 final review)', () => {
  it('STR-036 numbers the sections a profile keeps when `conditions` is given it, and every section when given none', () => {
    const marked = outline([
      section('annex', 'Annex', [], { conditions: [{ axis: 'audience', values: ['regulator'] }] }),
      section('findings', 'Findings'),
    ]);
    const numbered = (profile?: Record<string, string[]>) =>
      sectionNumbers(
        number(conditions(resolve(marked, new Map()), profile), defaultNumberingScheme),
      );
    expect(numbered({ audience: ['internal'] }).get(id('findings'))).toBe('1');
    expect(numbered({ audience: ['internal'] }).has(id('annex'))).toBe(false);
    expect(numbered({ audience: ['regulator'] }).get(id('findings'))).toBe('2');
    expect(numbered().get(id('findings'))).toBe('2');
  });
});
