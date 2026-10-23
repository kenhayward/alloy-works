import { describe, expect, it } from 'vitest';
import type { BlockNode } from '../content/model/blocks.js';
import {
  attributionOf,
  matchIdentity,
  resolveReferences,
  suggestedBlocks,
  type ImportMember,
} from './accept.js';

const paragraph = (id: string, content: object[] = []): BlockNode =>
  ({ type: 'paragraph', id, style: 'body', content }) as BlockNode;
const reference = (block: string) => ({
  type: 'crossReference',
  id: `r-${block}`,
  target: { kind: 'block', block },
  display: 'number',
});
const targets = (blocks: readonly BlockNode[]) =>
  (blocks[0] as { content: { target: object }[] }).content.map((each) => each.target);

const NODE_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaa';
const NODE_S = 'ssssssssssssssssssssssssss';
const COMPONENT_B = '00000000-0000-4000-8000-00000000000b';

describe('accepting an import (IMc)', () => {
  it('IMP-006 IMP-034 resolves each reference within the import to the block in its own component, a block of another component, or a heading, and names any still outside it', () => {
    const own = {
      component: '00000000-0000-4000-8000-00000000000a',
      node: NODE_A,
      headings: [],
      blocks: [
        paragraph('mine', [
          reference('mine'),
          reference('wb-7'),
          reference('theirs'),
          reference('wb-1'),
          reference('wx-1'),
        ]),
      ],
    };
    const other = {
      component: COMPONENT_B,
      node: 'bbbbbbbbbbbbbbbbbbbbbbbbbb',
      headings: [],
      blocks: [paragraph('theirs')],
    };
    const resolved = resolveReferences(own, {
      components: [own, other],
      sections: [{ node: NODE_S, headings: ['wb-1'] }],
      anchors: { 'wb-7': 'theirs' },
    });
    expect(targets(resolved.blocks)).toEqual([
      { kind: 'block', block: 'mine' },
      { kind: 'component', component: COMPONENT_B, block: 'theirs' },
      { kind: 'component', component: COMPONENT_B, block: 'theirs' },
      { kind: 'node', node: NODE_S },
      { kind: 'block', block: 'wx-1' },
    ]);
    expect(resolved.unresolved).toEqual(['wx-1']);
  });

  const members: ImportMember[] = [
    { id: 'p-ada', email: 'ada@example.com', name: 'Ada Lovelace' },
    { id: 'p-grace', email: 'grace@example.com', name: 'Grace Hopper' },
  ];
  const identities = [
    { name: 'Ada', email: 'ADA@example.com', carries: ['changes' as const] },
    { name: 'Grace Hopper', email: null, carries: ['comments' as const] },
    { name: 'Edsger', email: null, carries: ['comments' as const] },
  ];

  it('IMP-010 matches an identity to a member by an exact email, offers a name match to confirm, and matches nothing else', () => {
    expect(identities.map((each) => matchIdentity(each, members))).toEqual([
      { match: 'email', member: 'p-ada' },
      { match: 'name', member: 'p-grace' },
      { match: 'none', member: null },
    ]);
  });

  it('IMP-010 matches by email, a name only where its importer confirmed it, as attribution alone: the Word author kept as text, never the author', () => {
    const map = (name: string, confirmed: Readonly<Record<string, string>> = {}) =>
      attributionOf(name, { policy: 'map', identities, members, confirmed });
    expect(map('Ada')).toEqual({ member: 'p-ada', attributedTo: 'Ada (from Word)' });
    expect(map('Grace Hopper')).toEqual({
      member: null,
      attributedTo: 'Grace Hopper (from Word)',
    });
    expect(map('Grace Hopper', { 'Grace Hopper': 'p-grace' })).toEqual({
      member: 'p-grace',
      attributedTo: 'Grace Hopper (from Word)',
    });
    // A confirmation naming somebody the name does not match maps nothing.
    expect(map('Edsger', { Edsger: 'p-grace' })).toEqual({
      member: null,
      attributedTo: 'Edsger (from Word)',
    });
  });

  it('IMP-010 keeps every identity as text, or discards them, as the policy says', () => {
    const under = (policy: 'keep' | 'discard') =>
      attributionOf('Ada', { policy, identities, members, confirmed: {} });
    expect(under('keep')).toEqual({ member: null, attributedTo: 'Ada (from Word)' });
    expect(under('discard')).toEqual({ member: null, attributedTo: null });
  });

  it("IMP-005 makes an author's suggested content from the component's blocks, each changed one replaced", () => {
    const blocks = [paragraph('one'), paragraph('two')];
    expect(
      suggestedBlocks(blocks, [
        { author: 'Ada', block: 'two', proposed: [paragraph('two'), paragraph('new')] },
      ]).map((each) => each.id),
    ).toEqual(['one', 'two', 'new']);
  });
});
