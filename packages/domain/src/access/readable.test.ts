import { describe, expect, it } from 'vitest';

import { decide, type AccessGrant } from './decide.js';
import type { Level } from './level.js';
import type { Permission, PrincipalKind } from './permissions.js';
import { readableSet, type ReadableFacts, type ReadableSet } from './readable.js';

const ADA = 'principal-ada';
const GRACE = 'principal-grace';
const MEMBER_OF = 'group-editors';
const NOT_MEMBER_OF = 'group-outsiders';
const SPACES = ['space-clinical', 'space-quality'] as const;
/** Three content artifacts and one definition, which lives in no space. */
const ARTIFACTS: ReadonlyMap<string, string | null> = new Map([
  ['artifact-dosing', 'space-clinical'],
  ['artifact-warnings', 'space-clinical'],
  ['artifact-audit', 'space-quality'],
  ['artifact-field', null],
]);
const NOW = new Date('2026-09-16T12:00:00Z');

/** The predicate access.md gives search, traversal and the stream, evaluated here over one artifact. */
function inSet(set: ReadableSet, id: string, spaceId: string | null): boolean {
  const contained = spaceId === null ? set.tenant : set.spaces.includes(spaceId);
  return (contained && !set.excluded.includes(id)) || set.included.includes(id);
}

function chainOf(id: string): Level[] {
  const spaceId = ARTIFACTS.get(id) ?? null;
  return [
    { kind: 'artifact', id },
    ...(spaceId === null ? [] : [{ kind: 'space', id: spaceId } as const]),
    { kind: 'tenant' },
  ];
}

/** mulberry32: a small seeded generator, so a failure names a seed that reproduces it. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(next: () => number, from: readonly T[]): T {
  return from[Math.floor(next() * from.length)]!;
}

const ROLES: readonly AccessGrant['role'][] = [
  { id: 'role-reader', name: 'Reader', permissions: ['read'] },
  { id: 'role-author', name: 'Author', permissions: ['read', 'edit'] },
  { id: 'role-commenter', name: 'Commenter', permissions: ['comment'] as Permission[] },
];

function generated(seed: number): ReadableFacts {
  const next = random(seed);
  const levels: Level[] = [
    { kind: 'tenant' },
    ...SPACES.map((id) => ({ kind: 'space', id }) as const),
    ...[...ARTIFACTS.keys()].map((id) => ({ kind: 'artifact', id }) as const),
  ];
  const count = Math.floor(next() * 7);
  const grants = Array.from({ length: count }, (_, index): AccessGrant => ({
    id: `grant-${index}`,
    role: pick(next, ROLES),
    subject: pick(next, [
      { principal: ADA },
      { principal: GRACE },
      { group: MEMBER_OF },
      { group: NOT_MEMBER_OF },
    ]),
    level: pick(next, levels),
    effect: pick(next, ['allow', 'deny'] as const),
    expiresAt: pick(next, [null, new Date(NOW.getTime() - 1000), new Date(NOW.getTime() + 1000)]),
  }));
  return {
    principal: { id: ADA, kind: pick(next, ['user', 'external'] as PrincipalKind[]) },
    groups: [MEMBER_OF],
    spaces: SPACES,
    artifacts: ARTIFACTS,
    grants,
    now: NOW,
  };
}

describe('the readable set', () => {
  it('holds a space read is allowed at, or inherits from the tenant, and definitions when the tenant allows', () => {
    const set = readableSet({
      principal: { id: ADA, kind: 'user' },
      groups: [],
      spaces: SPACES,
      artifacts: new Map(),
      grants: [
        {
          id: 'grant-1',
          role: ROLES[0]!,
          subject: { principal: ADA },
          level: { kind: 'tenant' },
          effect: 'allow',
          expiresAt: null,
        },
        {
          id: 'grant-2',
          role: ROLES[0]!,
          subject: { principal: ADA },
          level: { kind: 'space', id: 'space-quality' },
          effect: 'deny',
          expiresAt: null,
        },
      ],
      now: NOW,
    });
    expect(set).toEqual({ tenant: true, spaces: ['space-clinical'], excluded: [], included: [] });
  });

  it('excludes an artifact denied inside a readable space, and includes one allowed outside', () => {
    const grant = (id: string, effect: 'allow' | 'deny', level: Level): AccessGrant => ({
      id,
      role: ROLES[0]!,
      subject: { principal: ADA },
      level,
      effect,
      expiresAt: null,
    });
    const set = readableSet({
      principal: { id: ADA, kind: 'user' },
      groups: [],
      spaces: SPACES,
      artifacts: ARTIFACTS,
      grants: [
        grant('grant-1', 'allow', { kind: 'space', id: 'space-clinical' }),
        grant('grant-2', 'deny', { kind: 'artifact', id: 'artifact-dosing' }),
        grant('grant-3', 'allow', { kind: 'artifact', id: 'artifact-audit' }),
        grant('grant-4', 'allow', { kind: 'artifact', id: 'artifact-field' }),
      ],
      now: NOW,
    });
    expect(set).toEqual({
      tenant: false,
      spaces: ['space-clinical'],
      excluded: ['artifact-dosing'],
      included: ['artifact-audit', 'artifact-field'],
    });
  });

  it('holds an artifact exactly when decide allows read on it, over two thousand generated tenants', () => {
    for (let seed = 1; seed <= 2000; seed += 1) {
      const facts = generated(seed);
      const set = readableSet(facts);
      for (const [id, spaceId] of ARTIFACTS) {
        const decision = decide('read', { ...facts, chain: chainOf(id) });
        expect(inSet(set, id, spaceId), `seed ${seed}, ${id}`).toBe(decision.allowed);
      }
    }
  });
});
