import { describe, expect, it } from 'vitest';

import { decide, type AccessFacts, type AccessGrant } from './decide.js';
import type { Level } from './level.js';
import { externalCap, isPermission, permissions } from './permissions.js';
import { starterRoles } from './role.js';

const ADA = '00000000-0000-4000-8000-00000000a0da';
const SPACE = '00000000-0000-4000-8000-00000000c11c';
const CONNECTION = '00000000-0000-4000-8000-00000000c0c0';

describe('the permission set', () => {
  it('IAM-019 covers read, create, edit, comment, suggest, approve, publish and administer', () => {
    for (const permission of [
      'read',
      'create',
      'edit',
      'comment',
      'suggest',
      'approve',
      'publish',
      'administer',
    ]) {
      expect(permissions).toContain(permission);
    }
  });

  it('is closed: designing templates, managing definitions, using a connection and writing SQL against one beside those, and nothing else', () => {
    expect([...permissions].sort()).toEqual(
      [
        'administer',
        'approve',
        'comment',
        'create',
        'design',
        'edit',
        'manage_definitions',
        'publish',
        'read',
        'suggest',
        'use_connection',
        'write_sql',
      ].sort(),
    );
    // write_sql joined with the check that reads it, in D2 (the D1 plan, D1-P).
    expect(isPermission('write_sql')).toBe(true);
    expect(isPermission('write_sqls')).toBe(false);
    expect(isPermission('edit')).toBe(true);
    expect(isPermission('delete')).toBe(false);
    expect(isPermission('toString')).toBe(false);
  });

  it('no starting role holds use_connection or write_sql, and an external principal is refused either whatever the grants say', () => {
    for (const role of starterRoles) {
      expect(role.permissions, role.name).not.toContain('use_connection');
      expect(role.permissions, role.name).not.toContain('write_sql');
    }
    const user: Level = { kind: 'artifact', id: CONNECTION };
    const grants: AccessGrant[] = [
      {
        id: 'grant-use',
        role: {
          id: 'role-use',
          name: 'Connection user',
          permissions: ['read', 'use_connection', 'write_sql'],
        },
        subject: { principal: ADA },
        level: user,
        effect: 'allow',
        expiresAt: new Date('2026-10-01T12:00:00Z'),
      },
    ];
    const facts = (kind: 'user' | 'external'): AccessFacts => ({
      principal: { id: ADA, kind },
      groups: [],
      chain: [user, { kind: 'space', id: SPACE }, { kind: 'tenant' }],
      grants,
      now: new Date('2026-09-30T12:00:00Z'),
      externalCapDays: 90,
    });
    expect(decide('use_connection', facts('user')).allowed).toBe(true);
    expect(decide('use_connection', facts('external'))).toMatchObject({
      allowed: false,
      reason: 'capped',
    });
    // Writing SQL is decided at the connection as using one is, and capped the same way.
    expect(decide('write_sql', facts('user')).allowed).toBe(true);
    expect(decide('write_sql', facts('external'))).toMatchObject({
      allowed: false,
      reason: 'capped',
    });
    expect(decide('read', facts('external')).allowed).toBe(true);
  });

  it('caps an external principal at reading, commenting and suggesting', () => {
    expect(permissions.filter((permission) => !externalCap.includes(permission))).toEqual([
      'read',
      'comment',
      'suggest',
    ]);
  });
});
