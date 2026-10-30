import { describe, expect, it } from 'vitest';

import { bindingContexts, type BindingState } from './bindingContexts.js';

const NODE = 'n'.repeat(26);

const state = (type: object, value: string, revised?: string): BindingState =>
  ({
    node: NODE,
    binding: {
      type: 'binding',
      id: 'b1',
      query: '44444444-4444-4444-8444-444444444441',
      parameters: {},
      mode: 'checked',
      take: { column: 'visits' },
    },
    held: {
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
      taken: { value, column: { name: 'visits', type } },
      act: 'resolve',
      keepable: false,
      by: { id: 'p', displayName: 'Ada' },
      at: '2026-10-05T09:00:00.000Z',
    },
    waiting: null,
    definition: null,
    connection: null,
    definitionChanged: false,
    sincePublished: null,
    mayCheck: true,
    mayResolve: true,
    ...(revised === undefined
      ? {}
      : { revisions: [{ id: 'r1', value: revised, stands: true, cell: null }] }),
  }) as unknown as BindingState;

const shownOf = (each: BindingState) => {
  const context = bindingContexts([each], null, 'en-GB').get(NODE)!;
  return context.kind === 'document' ? context.held.get('b1')!.shown : null;
};

describe('a held value a message form selects its arm by (the MF plan, MF-G)', () => {
  it("carries a number's canonical decimal and its column's scale, and nothing for a value that is no number", () => {
    expect(shownOf(state({ base: 'decimal', scale: 2 }, '1234.50'))).toMatchObject({
      value: '1,234.50',
      number: { value: '1234.50', scale: 2 },
    });
    expect(shownOf(state({ base: 'integer' }, '3'))).toMatchObject({
      number: { value: '3', scale: 0 },
    });
    expect(shownOf(state({ base: 'text' }, '3'))).not.toHaveProperty('number');
  });
});
