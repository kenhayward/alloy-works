import { describe, expect, it } from 'vitest';
import { assertTenantRole, tenantNames } from './names.js';

describe('tenant names', () => {
  it('derives the schema, runtime role and owner role from the id', () => {
    expect(tenantNames('acme01')).toEqual({
      schema: 't_acme01',
      role: 't_acme01',
      owner: 't_acme01_owner',
    });
  });

  it.each(['', 'Acme', 'acme-dev', 'acme dev', 'a'.repeat(41), 'robert"; drop role x; --'])(
    'refuses %j, which would not make a safe identifier',
    (id) => {
      expect(() => tenantNames(id)).toThrow(/lower-case letters and digits/);
    },
  );

  it('accepts a tenant role name and refuses anything else', () => {
    expect(assertTenantRole('t_acme01')).toBe('t_acme01');
    for (const name of ['postgres', 'aw_service', 't_acme01_owner', 'public', 't_', 'T_ACME']) {
      expect(() => assertTenantRole(name)).toThrow(/Not a tenant role name/);
    }
  });
});
