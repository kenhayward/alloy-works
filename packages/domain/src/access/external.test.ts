import { describe, expect, it } from 'vitest';

import { decide, type AccessFacts, type AccessGrant } from './decide.js';
import type { Level } from './level.js';
import { externalCap, permissions } from './permissions.js';

const ALICE = '00000000-0000-4000-8000-0000000a11ce';
const PARTNERS = '00000000-0000-4000-8000-00000000fa27';
const CLINICAL = '00000000-0000-4000-8000-00000000c11c';
const DOSING = '00000000-0000-4000-8000-00000000d05e';

const tenant: Level = { kind: 'tenant' };
const space: Level = { kind: 'space', id: CLINICAL };
const artifact: Level = { kind: 'artifact', id: DOSING };
const NOW = new Date('2026-09-16T12:00:00Z');
const LATER = new Date('2026-10-16T12:00:00Z');

const everything: AccessGrant['role'] = { id: 'role-all', name: 'Everything', permissions };

let sequence = 0;
function grant(
  level: Level,
  expiresAt: Date | null,
  effect: 'allow' | 'deny' = 'allow',
  subject: AccessGrant['subject'] = { principal: ALICE },
): AccessGrant {
  sequence += 1;
  return { id: `grant-${sequence}`, role: everything, subject, level, effect, expiresAt };
}

const external = (grants: readonly AccessGrant[], kind: 'external' | 'user' = 'external') =>
  ({
    principal: { id: ALICE, kind },
    groups: [PARTNERS],
    chain: [artifact, space, tenant],
    grants,
    now: NOW,
  }) satisfies AccessFacts;

describe('an external principal', () => {
  it('is refused every capped permission whatever the grants say, and the answer says the cap refused it', () => {
    const facts = external([grant(space, LATER)]);
    for (const permission of externalCap) {
      const decision = decide(permission, facts);
      expect(decision, permission).toMatchObject({ allowed: false, reason: 'capped' });
    }
    expect(decide('edit', facts).grants.map((reached) => reached.level)).toEqual([space]);
    expect(decide('read', facts)).toMatchObject({ allowed: true, reason: 'allowed', level: space });
  });

  it('is still refused by the cap when nothing grants the permission either', () => {
    expect(decide('edit', external([]))).toMatchObject({ allowed: false, reason: 'capped' });
  });

  it('is granted nothing at the tenant, directly or through a group', () => {
    const facts = external([
      grant(tenant, LATER),
      grant(tenant, LATER, 'allow', { group: PARTNERS }),
    ]);
    expect(decide('read', facts)).toMatchObject({
      allowed: false,
      reason: 'not_granted',
      checked: [artifact, space, tenant],
    });
    expect(decide('read', external(facts.grants, 'user')).allowed).toBe(true);
  });

  it('is granted nothing by a grant with no expiry, as a provider membership would arrive', () => {
    const facts = external([grant(space, null, 'allow', { group: PARTNERS })]);
    expect(decide('read', facts)).toMatchObject({ allowed: false, reason: 'not_granted' });
    expect(
      decide('read', external([grant(space, LATER, 'allow', { group: PARTNERS })])).allowed,
    ).toBe(true);
  });

  it('is refused nothing by a denial it ignores: what is ignored is ignored whatever its effect', () => {
    const facts = external([grant(artifact, null, 'deny'), grant(space, LATER)]);
    expect(decide('comment', facts)).toMatchObject({ allowed: true, level: space });
    expect(decide('comment', external(facts.grants, 'user'))).toMatchObject({
      allowed: false,
      level: artifact,
    });
  });
});
