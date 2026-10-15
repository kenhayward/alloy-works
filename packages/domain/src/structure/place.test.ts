import { describe, expect, it } from 'vitest';

import { PLACE_MAX, contentSize, placeSection, referencesUnder } from './place.js';
import { OUTLINE_SCHEMA_VERSION, parseOutlineDocument, type OutlineDocument } from './outline.js';

const A = '5e1d0c7a-0b1f-4c1e-9a52-3f6d7c2b9e01';
const B = '11111111-1111-4111-8111-111111111111';
const PIN = '22222222-2222-4222-8222-222222222222';
const title = (value: string) => [{ type: 'text' as const, value, marks: [] }];
const base = { numbered: true, matter: 'body' as const, pageBreak: 'none' as const, values: {} };

const counter = () => {
  let next = 0;
  return () => {
    next += 1;
    return `${'abcdefghij'[next % 10]!}${'abcdefghij'[Math.floor(next / 10) % 10]!}${'a'.repeat(24)}`;
  };
};

const outline = (nodes: unknown[]): OutlineDocument =>
  parseOutlineDocument({
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: 'Pump manual',
    language: 'en-GB',
    direction: 'ltr',
    nodes,
  });

const source = outline([
  {
    type: 'section',
    id: 's'.repeat(26),
    title: title('Maintenance'),
    ...base,
    values: { owner: 'kept' },
    children: [
      {
        type: 'reference',
        id: 'r'.repeat(26),
        component: A,
        mode: { kind: 'latest' },
        ...base,
        children: [],
      },
      {
        type: 'section',
        id: 't'.repeat(26),
        title: title('Weekly'),
        ...base,
        children: [
          {
            type: 'reference',
            id: 'q'.repeat(26),
            component: B,
            mode: { kind: 'pinned', version: PIN },
            ...base,
            children: [],
          },
          // The same component again: a second occurrence, placed again.
          {
            type: 'reference',
            id: 'p'.repeat(26),
            component: A,
            mode: { kind: 'latest' },
            ...base,
            children: [],
          },
        ],
      },
    ],
  },
]);

describe('placing another document section (the R2 plan, R2-F)', () => {
  it('finds every occurrence a section places, at any depth, in order', () => {
    expect(referencesUnder(source, 's'.repeat(26))).toEqual([A, B, A]);
    expect(referencesUnder(source, 't'.repeat(26))).toEqual([B, A]);
    expect(referencesUnder(source, 'r'.repeat(26))).toBeUndefined();
    expect(referencesUnder(source, 'x'.repeat(26))).toBeUndefined();
  });

  it('REU-054 places them as references under a new section of the author, in the mode chosen, copying no values', () => {
    const target = outline([]);
    const placed = placeSection(
      target,
      {
        parent: null,
        position: 0,
        title: title('Upkeep'),
        references: [A, B, A].map((component) => ({
          component,
          mode: { kind: 'approved' as const },
        })),
      },
      counter(),
    );
    if (!placed.applied) throw new Error(placed.reason);
    const [section] = placed.outline.nodes;
    expect(section).toMatchObject({ type: 'section', title: title('Upkeep'), values: {} });
    expect(
      section!.children.map((each) => [
        each.type,
        'component' in each ? each.component : null,
        'mode' in each ? each.mode : null,
      ]),
    ).toEqual([
      ['reference', A, { kind: 'approved' }],
      ['reference', B, { kind: 'approved' }],
      ['reference', A, { kind: 'approved' }],
    ]);
    // Nothing of the found section is shared: every node is new.
    const ids = [section!.id, ...section!.children.map((each) => each.id)];
    expect(new Set(ids).size).toBe(4);
    expect(ids).not.toContain('s'.repeat(26));
  });

  it('refuses where the template allows no section to be added, nothing to place, or too much', () => {
    const target = outline([]);
    const one = [{ component: A, mode: { kind: 'latest' as const } }];
    const refused = (references: typeof one, rules = {}) =>
      placeSection(
        target,
        { parent: null, position: 0, title: title('Upkeep'), references },
        counter(),
        rules,
      );
    expect(refused(one, { changes: { add: false, remove: true, reorder: true } })).toMatchObject({
      applied: false,
    });
    expect(refused([])).toMatchObject({ applied: false });
    expect(refused(Array.from({ length: PLACE_MAX + 1 }, () => one[0]!))).toMatchObject({
      applied: false,
    });
    expect(
      placeSection(
        target,
        { parent: 'z'.repeat(26), position: 0, title: title('Upkeep'), references: one },
        counter(),
      ),
    ).toMatchObject({ applied: false });
  });

  it('REU-046 measures a component content: its blocks and the characters of its text', () => {
    expect(
      contentSize({
        content: [
          { type: 'paragraph', content: [{ type: 'text', value: 'Open the valve.', marks: [] }] },
          {
            type: 'list',
            items: [
              {
                content: [
                  { type: 'paragraph', content: [{ type: 'text', value: 'Wait.', marks: [] }] },
                ],
              },
            ],
          },
        ],
      }),
    ).toEqual({ blocks: 2, characters: 20 });
  });
});
