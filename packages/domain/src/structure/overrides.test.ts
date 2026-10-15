import { describe, expect, it } from 'vitest';

import type { ContentDocument } from '../content/model/document.js';
import { OUTLINE_SCHEMA_VERSION, parseOutlineDocument, withholdComponents } from './outline.js';
import { applyOutlineOperation } from './operations.js';
import { applyOverrides, overridesSchema, overridesRefusal } from './overrides.js';

const V1 = '11111111-1111-4111-8111-111111111111';
const V2 = '22222222-2222-4222-8222-222222222222';
const COMPONENT = '5e1d0c7a-0b1f-4c1e-9a52-3f6d7c2b9e01';
const text = (value: string) => ({ type: 'text' as const, value, marks: [] });

const content = (opening: string, closing = 'Close the valve.'): ContentDocument =>
  ({
    schemaVersion: 1,
    id: COMPONENT,
    title: 'Flush the line',
    language: 'en-GB',
    direction: 'ltr',
    content: [
      { type: 'paragraph', id: 'p1', style: 'body', content: [text(opening)] },
      { type: 'paragraph', id: 'p2', style: 'body', content: [text(closing)] },
      { type: 'heading', id: 'h1', level: 2, content: [text('Steps')] },
    ],
  }) as unknown as ContentDocument;

const override = { block: 'p1', against: V1, text: [text('Open the north drain.')] };

describe('a local override on a reference (the R4 plan, R4-A to R4-C)', () => {
  it('REU-011 replaces a paragraph text in this document, keeping the paragraph and the rest', () => {
    const applied = applyOverrides(
      content('Open the drain.'),
      [override],
      new Map([[V1, content('Open the drain.')]]),
    );
    expect(applied.stale).toEqual([]);
    expect(applied.content.content[0]).toEqual({
      type: 'paragraph',
      id: 'p1',
      style: 'body',
      content: [text('Open the north drain.')],
    });
    expect(applied.content.content.slice(1)).toEqual(content('Open the drain.').content.slice(1));
  });

  it('REU-015 survives the component changing elsewhere, and fails loudly where its paragraph changed or went', () => {
    const was = new Map([[V1, content('Open the drain.')]]);
    // Another paragraph changed: the override still applies.
    const elsewhere = applyOverrides(content('Open the drain.', 'Shut it.'), [override], was);
    expect(elsewhere.stale).toEqual([]);
    expect(elsewhere.content.content[0]).toMatchObject({
      content: [text('Open the north drain.')],
    });
    // Its own paragraph changed: stale, and nothing replaced.
    const changed = applyOverrides(content('Open both drains.'), [override], was);
    expect(changed.stale).toEqual(['p1']);
    expect(changed.content.content[0]).toMatchObject({ content: [text('Open both drains.')] });
    // Gone: stale too.
    const gone = { ...content('x'), content: content('x').content.slice(1) } as ContentDocument;
    expect(applyOverrides(gone, [override], was).stale).toEqual(['p1']);
  });

  it('REU-012 lives on the reference, held to its shape: a paragraph, text runs alone, each block once, at most twenty', () => {
    const outline = (overrides: unknown) =>
      parseOutlineDocument({
        schemaVersion: OUTLINE_SCHEMA_VERSION,
        title: 'Pump manual',
        language: 'en-GB',
        direction: 'ltr',
        nodes: [
          {
            type: 'reference',
            id: 'r'.repeat(26),
            component: COMPONENT,
            mode: { kind: 'latest' },
            numbered: true,
            matter: 'body',
            pageBreak: 'none',
            values: {},
            overrides,
            children: [],
          },
        ],
      });
    expect(outline([override]).nodes[0]).toMatchObject({ overrides: [override] });
    expect(() =>
      outline([{ ...override, text: [{ type: 'footnote', id: 'f', content: [] }] }]),
    ).toThrow();
    expect(() => outline([override, override])).toThrow();
    expect(
      overridesSchema.safeParse(
        Array.from({ length: 21 }, (_, at) => ({ ...override, block: `p${at}` })),
      ).success,
    ).toBe(false);
  });

  it('refuses an override of what is not a paragraph of the component as it stood', () => {
    const contents = new Map([[V1, content('Open the drain.')]]);
    expect(overridesRefusal([override], contents)).toBeUndefined();
    expect(overridesRefusal([{ ...override, block: 'h1' }], contents)).toMatch(/paragraph/);
    expect(overridesRefusal([{ ...override, block: 'p9' }], contents)).toMatch(/paragraph/);
    expect(overridesRefusal([{ ...override, against: V2 }], contents)).toMatch(/version/);
    // A paragraph holding a footnote, a reference, a value or an equation is not overridden: its text
    // alone would take them away.
    const noted = content('Open the drain.');
    (noted.content[0] as { content: unknown[] }).content.push({
      type: 'footnote',
      id: 'f1',
      content: [],
    });
    expect(overridesRefusal([override], new Map([[V1, noted]]))).toMatch(/text alone/);
  });

  it('REU-012 is set on the reference by the outline, whole, and cleared by none', () => {
    const outline = parseOutlineDocument({
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      title: 'Pump manual',
      language: 'en-GB',
      direction: 'ltr',
      nodes: [
        {
          type: 'reference',
          id: 'r'.repeat(26),
          component: COMPONENT,
          mode: { kind: 'latest' },
          numbered: true,
          matter: 'body',
          pageBreak: 'none',
          values: {},
          children: [],
        },
        {
          type: 'section',
          id: 's'.repeat(26),
          title: [text('Scope')],
          numbered: true,
          matter: 'body',
          pageBreak: 'none',
          values: {},
          children: [],
        },
      ],
    });
    const next = () => 'n'.repeat(26);
    const set = applyOutlineOperation(
      outline,
      { operation: 'set', node: 'r'.repeat(26), overrides: [override] },
      next,
    );
    if (!set.applied) throw new Error(set.reason);
    expect(set.outline.nodes[0]).toMatchObject({ overrides: [override] });
    const cleared = applyOutlineOperation(
      set.outline,
      { operation: 'set', node: 'r'.repeat(26), overrides: [] },
      next,
    );
    if (!cleared.applied) throw new Error(cleared.reason);
    expect(cleared.outline.nodes[0]).not.toHaveProperty('overrides');
    expect(
      applyOutlineOperation(
        outline,
        { operation: 'set', node: 's'.repeat(26), overrides: [override] },
        next,
      ),
    ).toMatchObject({ applied: false });
  });

  it('withholds a reference overrides with its component from a reader who may not read it', () => {
    const outline = parseOutlineDocument({
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      title: 'Pump manual',
      language: 'en-GB',
      direction: 'ltr',
      nodes: [
        {
          type: 'reference',
          id: 'r'.repeat(26),
          component: COMPONENT,
          mode: { kind: 'latest' },
          numbered: true,
          matter: 'body',
          pageBreak: 'none',
          values: {},
          overrides: [override],
          children: [],
        },
      ],
    });
    expect(withholdComponents(outline, () => false).nodes[0]).not.toHaveProperty('overrides');
    expect(withholdComponents(outline, () => true).nodes[0]).toMatchObject({
      overrides: [override],
    });
  });
});
