import { describe, expect, it } from 'vitest';

import { endsRefused, relationshipTypeDefinitionSchema } from './type.js';

const supersedes = relationshipTypeDefinitionSchema.parse({
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-0000000000d1',
  name: 'Supersedes',
  inverseName: 'Superseded by',
  directed: true,
  from: { kinds: ['document'], cardinality: 'one', permission: 'edit' },
  to: { kinds: ['document'], cardinality: 'one', permission: 'read' },
  selfReference: false,
  acyclic: true,
  informational: true,
  schemas: [],
});

describe('relationship types (the R8 plan, R8-A, R8-B)', () => {
  it('REL-047 declares a name and its inverse, the kinds and cardinality at each end, self-reference, acyclicity and the permission at each end', () => {
    expect(supersedes).toMatchObject({
      inverseName: 'Superseded by',
      from: { kinds: ['document'], cardinality: 'one', permission: 'edit' },
      selfReference: false,
      acyclic: true,
    });
    expect(
      relationshipTypeDefinitionSchema.safeParse({
        ...supersedes,
        from: { ...supersedes.from, kinds: [] },
      }).success,
    ).toBe(false);
  });

  it('REL-008 REL-045 refuses ends of kinds the type does not permit, and an artifact related to itself', () => {
    const one = { artifact: 'a1', kind: 'document' };
    expect(
      endsRefused(supersedes, one, { artifact: 'a2', kind: 'document' }, true),
    ).toBeUndefined();
    expect(endsRefused(supersedes, one, { artifact: 'c1', kind: 'component' }, true)).toEqual({
      refused: 'kind',
      end: 'to',
      kind: 'component',
    });
    expect(endsRefused(supersedes, one, one, true)).toEqual({ refused: 'self' });
    expect(endsRefused({ ...supersedes, selfReference: true }, one, one, true)).toBeUndefined();
  });

  it('REL-037 offers a deprecated type for no new relationship, and keeps it valid on those that hold it', () => {
    const deprecated = { ...supersedes, deprecated: { replacement: 'other' } };
    const ends = [
      { artifact: 'a1', kind: 'document' },
      { artifact: 'a2', kind: 'document' },
    ] as const;
    expect(endsRefused(deprecated, ...ends, true)).toEqual({ refused: 'deprecated' });
    expect(endsRefused(deprecated, ...ends, false)).toBeUndefined();
  });
});
