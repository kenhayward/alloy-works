import { describe, expect, it } from 'vitest';

import { decide, type AccessFacts, type AccessGrant } from './decide.js';
import type { Level } from './level.js';
import { permissions, tokenScopes, type Permission } from './permissions.js';

const ADA = '00000000-0000-4000-8000-00000000a0da';
const CLINICAL = '00000000-0000-4000-8000-00000000c11c';
const DOSING = '00000000-0000-4000-8000-00000000d05e';

const tenant: Level = { kind: 'tenant' };
const space: Level = { kind: 'space', id: CLINICAL };
const artifact: Level = { kind: 'artifact', id: DOSING };

const NOW = new Date('2026-09-28T12:00:00Z');

const roles = {
  author: { id: 'role-author', name: 'Author', permissions: ['read', 'create', 'edit'] },
  publisher: { id: 'role-publisher', name: 'Publisher', permissions: ['read', 'publish'] },
  editing: { id: 'role-editing', name: 'Editing', permissions: ['edit'] },
} satisfies Record<string, AccessGrant['role']>;

let sequence = 0;
function grant(
  role: AccessGrant['role'],
  level: Level,
  effect: 'allow' | 'deny' = 'allow',
): AccessGrant {
  sequence += 1;
  return {
    id: `grant-${sequence}`,
    role,
    subject: { principal: ADA },
    level,
    effect,
    expiresAt: null,
  };
}

/** Ada's facts on the dosing component, as a request made with a token of these scopes reads them. */
function facts(
  grants: readonly AccessGrant[],
  scopes: readonly Permission[] | undefined,
  kind: 'user' | 'external' = 'user',
): AccessFacts {
  return {
    principal: { id: ADA, kind },
    groups: [],
    chain: [artifact, space, tenant],
    grants,
    now: NOW,
    scopes,
  };
}

describe("a token's scopes, a mask over its creator's grants (TK-A)", () => {
  it('offers every permission but read as a scope, since reading is never masked (TK-B)', () => {
    expect(tokenScopes).toEqual(permissions.filter((permission) => permission !== 'read'));
    expect(tokenScopes).not.toContain('read');
  });

  it('decides a session, which carries no scopes, exactly as before', () => {
    const held = [grant(roles.author, space), grant(roles.publisher, space)];
    for (const permission of permissions) {
      expect(decide(permission, facts(held, undefined)), permission).toEqual(
        decide(permission, { ...facts(held, undefined), scopes: undefined }),
      );
    }
    expect(decide('publish', facts(held, undefined))).toMatchObject({
      allowed: true,
      reason: 'allowed',
    });
  });

  it('IAM-034 lets a token scoped to edit edit where its creator may, and refuses publish as scoped, still naming the grants', () => {
    const publisher = grant(roles.publisher, space);
    const held = [grant(roles.author, space), publisher];
    expect(decide('edit', facts(held, ['edit']))).toMatchObject({
      allowed: true,
      reason: 'allowed',
      level: space,
    });
    expect(decide('publish', facts(held, ['edit']))).toMatchObject({
      allowed: false,
      reason: 'scoped',
      level: space,
      grants: [{ id: publisher.id, through: null }],
      checked: [artifact, space, tenant],
    });
  });

  it('IAM-034 IAM-062 never lets a scope confer a permission its creator holds through no role', () => {
    const author = [grant(roles.author, space)];
    expect(decide('publish', facts(author, ['publish']))).toMatchObject({
      allowed: false,
      reason: 'not_granted',
      level: null,
      grants: [],
    });
    // A denial is the creator's too, and stays a denial.
    const denied = [grant(roles.author, space), grant(roles.editing, artifact, 'deny')];
    expect(decide('edit', facts(denied, ['edit']))).toMatchObject({
      allowed: false,
      reason: 'denied',
      level: artifact,
    });
  });

  it('IAM-034 reads through a token with no scopes, and does nothing else', () => {
    const held = [grant(roles.author, space), grant(roles.publisher, space)];
    expect(decide('read', facts(held, []))).toMatchObject({ allowed: true, reason: 'allowed' });
    for (const permission of ['create', 'edit', 'publish'] as const) {
      expect(decide(permission, facts(held, [])), permission).toMatchObject({
        allowed: false,
        reason: 'scoped',
      });
    }
  });

  it('leaves the external cap as the reason for an external principal, whatever the scopes say', () => {
    const held = [grant(roles.author, space)];
    expect(decide('edit', facts(held, ['edit'], 'external'))).toMatchObject({
      allowed: false,
      reason: 'capped',
    });
  });
});
