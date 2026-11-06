import { describe, expect, it } from 'vitest';

import { COPY_MAX, chosenCopies, copyContent, copyOutline, type CopiedComponent } from './copy.js';
import { OUTLINE_SCHEMA_VERSION, parseOutlineDocument, type OutlineDocument } from './outline.js';
import type { ContentDocument } from '../content/model/document.js';

const A = '5e1d0c7a-0b1f-4c1e-9a52-3f6d7c2b9e01';
const B = '11111111-1111-4111-8111-111111111111';
const C = '33333333-3333-4333-8333-333333333333';
const PIN = '22222222-2222-4222-8222-222222222222';
const COPY_A = '44444444-4444-4444-8444-444444444444';
const COPY_A_VERSION = '55555555-5555-4555-8555-555555555555';
const COPY_B = '66666666-6666-4666-8666-666666666666';
const COPY_B_VERSION = '77777777-7777-4777-8777-777777777777';
const title = (value: string) => [{ type: 'text' as const, value, marks: [] }];
const base = { numbered: true, matter: 'body' as const, pageBreak: 'none' as const, values: {} };
const id = (letter: string) => letter.repeat(26);

const outline = (nodes: unknown[]): OutlineDocument =>
  parseOutlineDocument({
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: 'Pump manual',
    language: 'en-GB',
    direction: 'ltr',
    nodes,
  });

const reference = (node: string, component: string, mode: unknown, more: object = {}) => ({
  type: 'reference',
  id: id(node),
  component,
  mode,
  ...base,
  ...more,
  children: [],
});

const source = outline([
  {
    type: 'section',
    id: id('s'),
    title: title('Maintenance'),
    ...base,
    values: { owner: 'kept' },
    children: [
      reference(
        'r',
        A,
        { kind: 'latest' },
        {
          overrides: [
            { block: 'p1', against: PIN, text: title('Kept') },
            { block: 'p2', against: PIN, text: title('Gone') },
          ],
        },
      ),
      reference('q', B, { kind: 'approved' }),
      reference('t', C, { kind: 'latest' }),
      reference('u', A, { kind: 'pinned', version: PIN }, { origin: 'safety' }),
    ],
  },
]);

const replaced = new Map<string, CopiedComponent>([
  [A, { component: COPY_A, version: COPY_A_VERSION, keeps: (each) => each.block === 'p1' }],
  [B, { component: COPY_B, version: COPY_B_VERSION, keeps: () => true }],
]);

const references = (copied: OutlineDocument) =>
  copied.nodes[0]!.children.map((node) =>
    node.type === 'reference' ? { id: node.id, component: node.component, mode: node.mode } : null,
  );

describe('a copy of an outline (the RM plan, RM-I, RM-J)', () => {
  it('REU-058 keeps every node identity, section and value, and parses as an outline', () => {
    const { outline: copied } = copyOutline(source, replaced);
    const ids: string[] = [];
    const walk = (nodes: readonly OutlineDocument['nodes'][number][]) =>
      nodes.forEach((node) => {
        ids.push(node.id);
        walk(node.children);
      });
    walk(copied.nodes);
    expect(ids).toEqual([id('s'), id('r'), id('q'), id('t'), id('u')]);
    expect(copied.nodes[0]!.values).toEqual({ owner: 'kept' });
    expect(parseOutlineDocument(copied)).toEqual(copied);
    // The original is not changed.
    expect(references(source)[0]!.component).toBe(A);
  });

  it('REU-058 repoints a copied reference to the copy, and leaves a reused one and a required one alone', () => {
    const { outline: copied, counts } = copyOutline(source, replaced);
    expect(references(copied)).toEqual([
      { id: id('r'), component: COPY_A, mode: { kind: 'latest' } },
      { id: id('q'), component: COPY_B, mode: { kind: 'latest' } },
      { id: id('t'), component: C, mode: { kind: 'latest' } },
      // Placed for the template's requirement: never copied, under any choice (RM-K).
      { id: id('u'), component: A, mode: { kind: 'pinned', version: PIN } },
    ]);
    expect(counts.repointed).toBe(2);
  });

  it('REU-058 keeps pinned as pinned to the copy, and makes approved latest, counted', () => {
    const pinned = outline([reference('r', A, { kind: 'pinned', version: PIN })]);
    const { outline: copied } = copyOutline(pinned, replaced);
    expect(copied.nodes[0]).toMatchObject({
      component: COPY_A,
      mode: { kind: 'pinned', version: COPY_A_VERSION },
    });
    expect(copyOutline(source, replaced).counts.approvedToLatest).toBe(1);
  });

  it('REU-058 repoints an override whose block is unchanged at the copy, and drops the rest, counted', () => {
    const { outline: copied, counts } = copyOutline(source, replaced);
    const first = copied.nodes[0]!.children[0]!;
    expect(first.type === 'reference' && first.overrides).toEqual([
      { block: 'p1', against: COPY_A_VERSION, text: title('Kept') },
    ]);
    expect(counts).toMatchObject({ overridesRepointed: 1, overridesDropped: 1 });
  });

  it('REU-058 drops the overrides of a reference whose every override is stale', () => {
    const stale = outline([
      reference(
        'r',
        A,
        { kind: 'latest' },
        {
          overrides: [{ block: 'p2', against: PIN, text: title('Gone') }],
        },
      ),
    ]);
    const { outline: copied } = copyOutline(stale, replaced);
    expect(copied.nodes[0]).not.toHaveProperty('overrides');
  });
});

describe('a copied component (RM-J)', () => {
  const content: ContentDocument = {
    schemaVersion: 1,
    title: 'Install',
    language: 'en-GB',
    direction: 'ltr',
    content: [
      {
        type: 'paragraph',
        id: 'p1',
        style: 'body',
        content: [
          {
            type: 'crossReference',
            id: 'x1',
            target: { kind: 'component', component: A, block: 'b1' },
            display: 'number',
          },
          {
            type: 'crossReference',
            id: 'x2',
            target: { kind: 'component', component: C, block: 'b1' },
            display: 'number',
          },
          {
            type: 'crossReference',
            id: 'x3',
            target: { kind: 'node', node: id('s') },
            display: 'number',
          },
        ],
      },
    ],
  } as ContentDocument;

  it('REU-058 remaps a component cross-reference to a copy, leaving the rest', () => {
    const { content: copied, remapped } = copyContent(content, new Map([[A, COPY_A]]));
    const targets = (copied.content[0] as { content: { target: unknown }[] }).content.map(
      (each) => each.target,
    );
    expect(targets).toEqual([
      { kind: 'component', component: COPY_A, block: 'b1' },
      { kind: 'component', component: C, block: 'b1' },
      { kind: 'node', node: id('s') },
    ]);
    expect(remapped).toBe(1);
    expect((content.content[0] as { content: { target: unknown }[] }).content[0]!.target).toEqual({
      kind: 'component',
      component: A,
      block: 'b1',
    });
  });
});

describe('which components a document copy copies (RM-G, RM-H, RM-K)', () => {
  const placed = [
    { component: A, own: true, kept: false },
    { component: B, own: false, kept: false },
    { component: C, own: true, kept: true },
  ];

  it('REU-057 reuses every one, copies only its own, or copies every one, never one deleted or archived', () => {
    expect(chosenCopies('reuse', placed)).toEqual([]);
    expect(chosenCopies('own', placed)).toEqual([A]);
    expect(chosenCopies('all', placed)).toEqual([A, B]);
  });

  it('sets COPY_MAX at 200, as PLACE_MAX holds a placement', () => {
    expect(COPY_MAX).toBe(200);
  });
});
