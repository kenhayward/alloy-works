import type { OutlineViewNode } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import {
  componentsBeneath,
  numberedOn,
  sameNumber,
  typedNumber,
  usedElsewhere,
  whereItSits,
  withoutTypedNumber,
} from './partSummary.js';

const words = (value: string) => [{ type: 'text', value, marks: [] }] as never;

const section = (
  id: string,
  title: string,
  children: OutlineViewNode[] = [],
  over: Partial<OutlineViewNode> = {},
) =>
  ({
    id,
    type: 'section',
    title: words(title),
    numbered: true,
    matter: 'body',
    pageBreak: 'none',
    values: {},
    children,
    ...over,
  }) as unknown as OutlineViewNode;

const reference = (id: string, component: string | null) =>
  ({
    id,
    type: 'reference',
    component,
    numbered: true,
    matter: 'body',
    pageBreak: 'none',
    values: {},
    children: [],
    mode: { kind: 'latest' },
  }) as unknown as OutlineViewNode;

describe('a number typed at the start of a title', () => {
  it.each([
    ['6. Performance testing', '6.'],
    ['6.1 Bench', '6.1'],
    ['A.2 Results', 'A.2'],
    ['10.2.3. Deep', '10.2.3.'],
  ])('finds it in %s', (title, typed) => {
    expect(typedNumber(words(title))).toBe(typed);
  });

  it.each([
    'A study of lenses',
    '3 dimensions',
    '2026 results',
    'Results',
    '6.',
    'e.g. this one',
    '',
  ])('finds none in "%s"', (title) => {
    expect(typedNumber(words(title))).toBeNull();
  });

  it('finds none where the title opens with something else, such as an equation', () => {
    expect(
      typedNumber([
        { type: 'math', latex: 'x', alt: '6. x' },
        { type: 'text', value: ' 6. Bench', marks: [] },
      ] as never),
    ).toBeNull();
  });

  it('takes the number and the space off, keeping the rest of the title as it was', () => {
    const marked = { type: 'text', value: 'Bold', marks: [{ type: 'strong' }] };
    expect(
      withoutTypedNumber([{ type: 'text', value: '6.1  Bench ', marks: [] }, marked] as never),
    ).toEqual([{ type: 'text', value: 'Bench ', marks: [] }, marked]);
  });

  it('calls two numbers the same with or without a closing dot, and no others', () => {
    expect(sameNumber('6.', '6')).toBe(true);
    expect(sameNumber('6.1', '6.1.')).toBe(true);
    expect(sameNumber('6', '7')).toBe(false);
    expect(sameNumber('6.1', '6.11')).toBe(false);
  });
});

describe('what a part would be numbered', () => {
  it('turns on the part and everything above it, and nothing beside it', () => {
    const before = [
      section('a', 'One', [], { numbered: false }),
      section('p', 'Two', [section('c', 'Three', [], { numbered: false })], { numbered: false }),
    ];
    const after = numberedOn(before, 'c');
    expect(after[0]!.numbered).toBe(false);
    expect(after[1]!.numbered).toBe(true);
    expect(after[1]!.children[0]!.numbered).toBe(true);
    expect(before[1]!.numbered).toBe(false);
  });
});

describe('where a part sits', () => {
  const inner = reference('r', 'c1');
  const child = section('s2', 'Inner', [inner]);
  const nodes = [section('s1', 'Outer', [child], { matter: 'appendix' })];

  it('says nothing above it at the top, and its own matter', () => {
    expect(whereItSits(nodes, 's1')).toEqual({ parent: null, matter: 'appendix' });
  });

  it('says what holds it, and the matter of the top of its branch', () => {
    expect(whereItSits(nodes, 'r')).toEqual({ parent: child, matter: 'appendix' });
  });

  it('counts every component beneath, those the reader may not read among them', () => {
    const held = section('s', 'S', [
      reference('a', 'c1'),
      section('t', 'T', [reference('b', null)]),
    ]);
    expect(componentsBeneath(held)).toBe(2);
    expect(componentsBeneath(reference('a', 'c1'))).toBe(1);
  });
});

describe('where else a component is used', () => {
  const uses = (ids: readonly string[], unreadableDocuments = false) =>
    ({ documents: ids.map((id) => ({ id })), unreadableDocuments }) as never;

  it('says only here where this document alone places it and nothing is hidden', () => {
    expect(usedElsewhere(uses(['d']), 'd')).toEqual({ kind: 'only' });
  });

  it('counts the other documents the reader may read', () => {
    expect(usedElsewhere(uses(['d', 'e', 'f']), 'd')).toEqual({ kind: 'more', count: 2 });
  });

  it('never says only here, nor a count, where a document it may not read places it too', () => {
    expect(usedElsewhere(uses(['d'], true), 'd')).toEqual({ kind: 'elsewhere' });
    expect(usedElsewhere(uses(['d', 'e'], true), 'd')).toEqual({ kind: 'elsewhere' });
  });
});
