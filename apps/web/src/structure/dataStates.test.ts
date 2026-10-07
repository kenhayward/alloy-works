import { describe, expect, it } from 'vitest';

import type { BindingState } from './bindingContexts.js';
import { dataState, type DataState } from './dataStates.js';

const value = { value: '4.5', column: { name: 'depth', type: { base: 'text' } } } as const;

const held = (over: Partial<NonNullable<BindingState['held']>> = {}) => ({
  dataset: 'd',
  version: 'v1',
  number: '0.1',
  provenance: {
    parameters: {},
    sql: null,
    identity: 'service',
    at: '2026-10-05T09:00:00.000Z',
    rowCount: 1,
    checksum: '0'.repeat(64),
    columns: [],
  },
  name: null,
  stale: false,
  taken: value,
  act: 'resolve' as const,
  keepable: false,
  by: { id: 'p', displayName: 'Ada' },
  at: '2026-10-05T09:00:00.000Z',
  ...over,
});

const view = (over: Partial<BindingState> = {}): BindingState => ({
  node: 'n'.repeat(26),
  binding: {
    type: 'binding',
    id: 'b1',
    query: '44444444-4444-4444-8444-444444444441',
    parameters: {},
    mode: 'checked',
    take: { column: 'depth' },
  },
  held: held(),
  waiting: null,
  definition: null,
  connection: null,
  definitionChanged: false,
  sincePublished: null,
  mayCheck: true,
  mayResolve: true,
  ...over,
});

describe("a binding's state in the Data tab (the B4 plan, B4-C)", () => {
  it("decides each binding's state in the design's order, the first that holds", () => {
    const waiting = { version: 'v2', provenance: held().provenance, taken: value };
    const cases: [BindingState, boolean, DataState][] = [
      [view({ held: null, definitionChanged: true }), true, 'never'],
      [view({ held: held({ stale: true }), waiting }), true, 'stale'],
      [view({ waiting }), true, 'failed'],
      [view({ held: held({ taken: { failure: 'value_none' } }), waiting }), false, 'failed'],
      [view({ held: null, unread: true }), false, 'failed'],
      [view({ waiting, definitionChanged: true }), false, 'waiting'],
      [view({ definitionChanged: true, sincePublished: 'new' }), false, 'definition'],
      [view({ sincePublished: ['dataset'] }), false, 'published'],
      [view(), false, 'holding'],
    ];
    for (const [each, failed, expected] of cases) {
      expect(dataState(each, failed), expected).toBe(expected);
    }
  });
});
