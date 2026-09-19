import { describe, expect, it } from 'vitest';

import { permissions } from './permissions.js';
import { allowable, checkRole, starterRoles } from './role.js';

describe('a role', () => {
  it('holds at least one permission from the closed set, each once', () => {
    expect(checkRole(['read', 'edit'])).toBeUndefined();
    expect(checkRole(['read', 'delete'])).toBe('role.unknown_permission');
    expect(checkRole(['read', 'edit', 'read'])).toBe('role.repeated_permission');
    expect(checkRole([])).toBe('role.empty');
  });

  it('need not hold read, but is allowed only if it does', () => {
    expect(checkRole(['edit'])).toBeUndefined();
    expect(allowable(['edit'])).toBe(false);
    expect(allowable(['read', 'edit'])).toBe(true);
  });

  it('starts a tenant with nine, each of which passes the same check', () => {
    expect(starterRoles.map((role) => role.name)).toEqual([
      'Reader',
      'Reviewer',
      'Author',
      'Approver',
      'Designer',
      'Definitions manager',
      'Administrator',
      'Editing',
      'Publisher',
    ]);
    for (const role of starterRoles) {
      expect(checkRole(role.permissions), role.name).toBeUndefined();
    }
  });

  it('gives every starter role but Editing read, so Editing is the one a tenant can only deny', () => {
    expect(
      starterRoles.filter((role) => !allowable(role.permissions)).map((role) => role.name),
    ).toEqual(['Editing']);
  });

  it('gives publish to Publisher alone, because publishing releases content (decision L)', () => {
    expect(
      starterRoles.filter((role) => role.permissions.includes('publish')).map((role) => role.name),
    ).toEqual(['Publisher']);
    const held = new Set(starterRoles.flatMap((role) => role.permissions));
    expect(permissions.filter((permission) => !held.has(permission))).toEqual([]);
  });
});
