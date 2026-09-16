import { describe, expect, it } from 'vitest';

import { externalCap, isPermission, permissions } from './permissions.js';

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

  it('is closed: designing templates and managing definitions beside those, and nothing else', () => {
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
      ].sort(),
    );
    expect(isPermission('edit')).toBe(true);
    expect(isPermission('delete')).toBe(false);
    expect(isPermission('toString')).toBe(false);
  });

  it('caps an external principal at reading, commenting and suggesting', () => {
    expect(permissions.filter((permission) => !externalCap.includes(permission))).toEqual([
      'read',
      'comment',
      'suggest',
    ]);
  });
});
