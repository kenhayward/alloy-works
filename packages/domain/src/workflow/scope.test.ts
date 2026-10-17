import { describe, expect, it } from 'vitest';
import { effectiveRevision, scopeSchema, type ScopedRevision } from './scope.js';

const revision = (
  number: number,
  scopes: { axis: string; value: string; pending?: boolean }[] = [],
): ScopedRevision => ({
  number,
  scopes: scopes.map((each) => ({ ...each, pending: each.pending ?? false })),
});

describe('which revision is effective in a scope (the R15 plan, R15-C)', () => {
  const us = { market: ['us'] };
  it('LIF-042 answers one revision for any scope: the newest scoped to it, else the newest unscoped', () => {
    const revisions = [
      revision(1),
      revision(2, [{ axis: 'market', value: 'us' }]),
      revision(3),
      revision(4, [{ axis: 'market', value: 'eu' }]),
    ];
    // A newer unscoped revision does not displace one scoped to the market; elsewhere it applies.
    expect(effectiveRevision(revisions, us)).toBe(2);
    expect(effectiveRevision(revisions, { market: ['eu'] })).toBe(4);
    expect(effectiveRevision(revisions, { market: ['apac'] })).toBe(3);
    expect(effectiveRevision(revisions, {})).toBe(3);
    // A new revision scoped to the same value does.
    expect(
      effectiveRevision([...revisions, revision(5, [{ axis: 'market', value: 'us' }])], us),
    ).toBe(5);
    // Two values of one profile matching two revisions: the newer.
    expect(effectiveRevision(revisions, { market: ['us', 'eu'] })).toBe(4);
    // Nothing designated, or only revisions scoped elsewhere: none.
    expect(effectiveRevision([], us)).toBeNull();
    expect(effectiveRevision([revision(1, [{ axis: 'market', value: 'eu' }])], us)).toBeNull();
  });

  it('LIF-047 keeps the revision before effective in a scope where the newer one waits on acceptance', () => {
    const revisions = [
      revision(1),
      revision(2, [{ axis: 'market', value: 'us' }]),
      revision(3, [
        { axis: 'market', value: 'us', pending: true },
        { axis: 'market', value: 'eu' },
      ]),
    ];
    expect(effectiveRevision(revisions, us)).toBe(2);
    expect(effectiveRevision(revisions, { market: ['eu'] })).toBe(3);
  });

  it('holds a scope to declared keys, each value once, each party a person or a group', () => {
    const party = { kind: 'group', id: '10000000-0000-4000-8000-000000000001' };
    expect(
      scopeSchema.safeParse([
        { axis: 'market', value: 'us', party },
        { axis: 'site', value: 'plant_7', party: null },
      ]).success,
    ).toBe(true);
    for (const wrong of [
      [{ axis: 'Market', value: 'us', party: null }],
      [
        { axis: 'market', value: 'us', party: null },
        { axis: 'market', value: 'us', party },
      ],
      [{ axis: 'market', value: 'us', party: { kind: 'robot', id: party.id } }],
    ]) {
      expect(scopeSchema.safeParse(wrong).success).toBe(false);
    }
  });
});
