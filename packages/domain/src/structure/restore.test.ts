import { describe, expect, it } from 'vitest';

import { outlineChangesRefused, repointsBetween } from './operations.js';
import {
  OUTLINE_SCHEMA_VERSION,
  parseOutlineDocument,
  type OutlineDocument,
  type OutlineNode,
} from './outline.js';

const COMPONENT = '5e1d0c7a-0b1f-4c1e-9a52-3f6d7c2b9e01';
const VERSION = '11111111-1111-4111-8111-111111111111';
const LATER = '22222222-2222-4222-8222-222222222222';
const id = (letter: string) => letter.repeat(26);

const base = { numbered: true, matter: 'body', pageBreak: 'none', values: {} } as const;
const section = (key: string, children: OutlineNode[] = []): OutlineNode => ({
  ...base,
  id: id(key),
  type: 'section',
  title: [{ type: 'text', value: key, marks: [] }],
  children,
});
const reference = (key: string, mode: Extract<OutlineNode, { type: 'reference' }>['mode']) =>
  ({
    ...base,
    id: id(key),
    type: 'reference',
    component: COMPONENT,
    mode,
    children: [],
  }) as OutlineNode;
const outline = (nodes: OutlineNode[]): OutlineDocument =>
  parseOutlineDocument({
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: 'The dosing report',
    language: 'en-GB',
    direction: 'ltr',
    nodes,
  });

describe('a restored outline against the latest (the RS plan, RS-F, RS-G)', () => {
  it('names each reference whose mode differs, from and to; a reference added or gone is not one', () => {
    const before = outline([
      reference('a', { kind: 'pinned', version: VERSION }),
      reference('b', { kind: 'latest' }),
      reference('c', { kind: 'latest' }),
    ]);
    const after = outline([
      reference('a', { kind: 'pinned', version: LATER }),
      reference('b', { kind: 'latest' }),
      section('s', [reference('d', { kind: 'approved' })]),
    ]);
    expect(repointsBetween(before, after)).toEqual([
      {
        node: id('a'),
        component: COMPONENT,
        from: { kind: 'pinned', version: VERSION },
        to: { kind: 'pinned', version: LATER },
      },
    ]);
    // A move is not a re-point.
    const moved = outline([section('s', [reference('a', { kind: 'pinned', version: VERSION })])]);
    expect(repointsBetween(before, moved)).toEqual([]);
  });

  it("refuses, by the template's changes and by code, a section the restore would add, remove or reorder", () => {
    const latest = outline([section('a'), section('b'), section('c')]);
    const none = { add: false, remove: false, reorder: false };
    expect(outlineChangesRefused(latest, latest, none)).toEqual([]);
    // c gone, d back: removed and added.
    expect(
      outlineChangesRefused(latest, outline([section('a'), section('b'), section('d')]), none),
    ).toEqual([
      {
        why: 'sections_added',
        reason: "This document's template does not allow sections to be added",
      },
      {
        why: 'sections_removed',
        reason: "This document's template does not allow sections to be removed",
      },
    ]);
    // b before a; and b under a.
    const reordered = {
      why: 'sections_reordered',
      reason: "This document's template does not allow sections to be reordered",
    };
    expect(
      outlineChangesRefused(latest, outline([section('b'), section('a'), section('c')]), none),
    ).toEqual([reordered]);
    expect(
      outlineChangesRefused(latest, outline([section('a', [section('b')]), section('c')]), none),
    ).toEqual([reordered]);
    // Allowed, nothing is refused; and a reference is never held.
    expect(
      outlineChangesRefused(latest, outline([section('d')]), {
        add: true,
        remove: true,
        reorder: true,
      }),
    ).toEqual([]);
    expect(
      outlineChangesRefused(
        latest,
        outline([section('a'), reference('r', { kind: 'latest' }), section('b'), section('c')]),
        none,
      ),
    ).toEqual([]);
  });
});
