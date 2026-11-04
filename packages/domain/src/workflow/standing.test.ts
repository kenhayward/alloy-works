import { describe, expect, it } from 'vitest';

import { revisionStanding, type TimedRevision } from './standing.js';

const at = (day: number) => new Date(Date.UTC(2026, 0, day));
const NOW = at(10);
const revision = (
  number: number,
  day: number,
  over: Partial<TimedRevision> = {},
): TimedRevision => ({
  number,
  designatedAt: at(day),
  effectiveAt: null,
  scopes: [],
  ...over,
});
const scoped = (value: string, accepted: Date | null) => ({
  axis: 'market',
  value,
  acceptedAt: accepted,
});
const standings = (...revisions: TimedRevision[]) =>
  Object.fromEntries(revisionStanding(revisions, NOW));

describe('where a revision stands, read over time (the LS and VP plan, D1)', () => {
  it('finds the newest revision effective, and the one before it superseded by it', () => {
    expect(standings(revision(1, 1), revision(2, 2))).toEqual({
      1: { standing: 'superseded', by: 2 },
      2: { standing: 'effective', scopes: [] },
    });
  });

  it('keeps a revision dated ahead pending, and the one before it effective', () => {
    expect(standings(revision(1, 1), revision(2, 2, { effectiveAt: at(20) }))).toEqual({
      1: { standing: 'effective', scopes: [] },
      2: { standing: 'pending' },
    });
  });

  it('says never in force of a revision replaced before its date arrived', () => {
    expect(
      standings(revision(1, 1, { effectiveAt: at(5) }), revision(2, 2, { effectiveAt: at(3) })),
    ).toEqual({
      1: { standing: 'neverInForce' },
      2: { standing: 'effective', scopes: [] },
    });
    expect(
      standings(revision(1, 1, { effectiveAt: at(20) }), revision(2, 2, { effectiveAt: at(20) })),
    ).toEqual({ 1: { standing: 'neverInForce' }, 2: { standing: 'pending' } });
  });

  it('says never in force of a revision dated ahead that a newer one in force already replaces', () => {
    expect(standings(revision(1, 1, { effectiveAt: at(20) }), revision(2, 2))).toEqual({
      1: { standing: 'neverInForce' },
      2: { standing: 'effective', scopes: [] },
    });
  });

  it('keeps pending a revision that will hold for a while before the next one, dated after it', () => {
    expect(
      standings(revision(1, 1, { effectiveAt: at(20) }), revision(2, 2, { effectiveAt: at(25) })),
    ).toEqual({ 1: { standing: 'pending' }, 2: { standing: 'pending' } });
  });

  it('does not let a newer unscoped revision displace a scoped one', () => {
    expect(standings(revision(1, 1, { scopes: [scoped('uk', at(1))] }), revision(2, 2))).toEqual({
      1: { standing: 'effective', scopes: [{ axis: 'market', value: 'uk' }] },
      2: { standing: 'effective', scopes: [] },
    });
  });

  it('names only the places a revision still holds, and supersedes it once it holds none', () => {
    const first = revision(1, 1, { scopes: [scoped('uk', at(1)), scoped('fr', at(1))] });
    const uk = revision(2, 2, { scopes: [scoped('uk', at(2))] });
    expect(standings(first, uk)[1]).toEqual({
      standing: 'effective',
      scopes: [{ axis: 'market', value: 'fr' }],
    });
    const fr = revision(3, 3, { scopes: [scoped('fr', at(3))] });
    expect(standings(first, uk, fr)[1]).toEqual({ standing: 'superseded', by: 3 });
  });

  it('leaves a revision waiting on acceptance pending, with the one before it effective', () => {
    const before = revision(1, 1, { scopes: [scoped('uk', at(1))] });
    const waits = revision(2, 2, { scopes: [scoped('uk', null)] });
    expect(standings(before, waits)).toEqual({
      1: { standing: 'effective', scopes: [{ axis: 'market', value: 'uk' }] },
      2: { standing: 'pending' },
    });
  });

  it('says never in force of a revision still unaccepted when the next took its place', () => {
    const waits = revision(1, 1, { scopes: [scoped('uk', null)] });
    const next = revision(2, 2, { scopes: [scoped('uk', at(2))] });
    expect(standings(waits, next)[1]).toEqual({ standing: 'neverInForce' });
  });

  it('counts an acceptance from when it was given, not from the designation', () => {
    const before = revision(1, 1, { scopes: [scoped('uk', at(1))] });
    const accepted = revision(2, 2, { scopes: [scoped('uk', at(5))] });
    expect(standings(before, accepted)[1]).toEqual({ standing: 'superseded', by: 2 });
    const notYet = revision(2, 2, { scopes: [scoped('uk', at(15))] });
    expect(standings(before, notYet)).toEqual({
      1: { standing: 'effective', scopes: [{ axis: 'market', value: 'uk' }] },
      2: { standing: 'pending' },
    });
  });
});
