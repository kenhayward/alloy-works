import { describe, expect, it } from 'vitest';

import { holdsRole, type AccessFacts, type AccessGrant } from './decide.js';
import type { Level } from './level.js';

const ADA = '00000000-0000-4000-8000-00000000a0da';
const QUALITY = '00000000-0000-4000-8000-00000000901a';
const CLINICAL = '00000000-0000-4000-8000-00000000c11c';
const DOSING = '00000000-0000-4000-8000-00000000d05e';

const tenant: Level = { kind: 'tenant' };
const space: Level = { kind: 'space', id: CLINICAL };
const artifact: Level = { kind: 'artifact', id: DOSING };

const NOW = new Date('2026-11-07T12:00:00Z');
const DAY = 86_400_000;

const technical = {
  id: 'role-technical',
  name: 'Technical',
  permissions: ['read', 'approve'],
} satisfies AccessGrant['role'];
const quality = {
  id: 'role-quality',
  name: 'Quality',
  permissions: ['read', 'approve'],
} satisfies AccessGrant['role'];

let sequence = 0;
function grant(
  role: AccessGrant['role'],
  level: Level,
  extra: Partial<Omit<AccessGrant, 'role' | 'level'>> = {},
): AccessGrant {
  sequence += 1;
  return {
    id: `grant-${sequence}`,
    role,
    subject: { principal: ADA },
    level,
    effect: 'allow',
    expiresAt: null,
    ...extra,
  };
}

const facts = (grants: readonly AccessGrant[], extra: Partial<AccessFacts> = {}): AccessFacts => ({
  principal: { id: ADA, kind: 'user' },
  groups: [QUALITY],
  chain: [artifact, space, tenant],
  grants,
  now: NOW,
  externalCapDays: 90,
  ...extra,
});

describe('holding a role (the ES plan, ES-F)', () => {
  it('holds a role granted directly, and not one granted nobody', () => {
    const given = facts([grant(technical, space)]);
    expect(holdsRole(given, 'Technical', 'approve')).toBe(true);
    expect(holdsRole(given, 'Quality', 'approve')).toBe(false);
  });

  it('holds a role granted to a group the principal is in, and not to one they are not', () => {
    const to = (group: string) => facts([grant(quality, tenant, { subject: { group } })]);
    expect(holdsRole(to(QUALITY), 'Quality', 'approve')).toBe(true);
    expect(holdsRole(to('another-group'), 'Quality', 'approve')).toBe(false);
  });

  it('does not hold a role whose grant has expired', () => {
    const expired = grant(technical, space, { expiresAt: new Date(NOW.getTime() - DAY) });
    expect(holdsRole(facts([expired]), 'Technical', 'approve')).toBe(false);
  });

  it('does not hold a role where a nearer denial of another role refuses the permission', () => {
    const denied = facts([grant(technical, tenant), grant(quality, artifact, { effect: 'deny' })]);
    expect(holdsRole(denied, 'Technical', 'approve')).toBe(false);
    // And a nearer allow of another role confers nothing under this one.
    const other = facts([grant(technical, tenant, { effect: 'deny' }), grant(quality, artifact)]);
    expect(holdsRole(other, 'Technical', 'approve')).toBe(false);
    expect(holdsRole(other, 'Quality', 'approve')).toBe(true);
  });

  it('does not hold a role whose grant lacks the permission', () => {
    const reading = {
      id: 'role-reading',
      name: 'Reading',
      permissions: ['read'],
    } satisfies AccessGrant['role'];
    const given = facts([grant(reading, tenant), grant(quality, tenant)]);
    expect(holdsRole(given, 'Reading', 'approve')).toBe(false);
  });

  it('refuses an external principal, whatever they are granted and for whatever permission', () => {
    const given = facts([grant(technical, space, { expiresAt: new Date(NOW.getTime() + DAY) })], {
      principal: { id: ADA, kind: 'external' },
    });
    expect(holdsRole(given, 'Technical', 'approve')).toBe(false);
    expect(holdsRole(given, 'Technical', 'read')).toBe(false);
  });

  it('refuses a service principal: a signature is a person’s', () => {
    const given = facts([grant(technical, space)], { principal: { id: ADA, kind: 'service' } });
    expect(holdsRole(given, 'Technical', 'approve')).toBe(false);
  });

  it('refuses a support principal, whatever they are granted', () => {
    const given = facts([grant(technical, space)], {
      support: {
        id: 'support-1',
        scope: 'content',
        spaces: [CLINICAL],
        purpose: 'Why the outline will not save',
        expiresAt: new Date(NOW.getTime() + DAY),
        revokedAt: null,
      },
    });
    expect(holdsRole(given, 'Technical', 'approve')).toBe(false);
  });

  it('refuses a token, even one scoped to approve', () => {
    for (const scopes of [['approve'], ['read']] as const) {
      const given = facts([grant(technical, space)], { scopes });
      expect(holdsRole(given, 'Technical', 'approve')).toBe(false);
    }
  });
});
