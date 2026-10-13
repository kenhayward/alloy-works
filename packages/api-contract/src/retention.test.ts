import { describe, expect, it } from 'vitest';
import { RetentionBody } from './retention.js';
import { routes } from './routes.js';

describe('retention keeps in the contract (the DL plan, DL-G)', () => {
  it('reads and sets keeps by administer at the tenant', () => {
    const paths = [routes.getRetention, routes.setRetention].map((route) => {
      expect(route.access).toEqual({
        check: 'permission',
        permission: 'administer',
        target: { tenant: true },
      });
      return `${route.method} ${route.path}`;
    });
    expect(paths).toEqual(['GET /v1/retention', 'PUT /v1/retention']);
  });

  it('takes a kind, a space or both, and whole days or null to clear', () => {
    const id = '0b6f6b8e-4a39-4c1e-9d0f-3c0a8f1e2d41';
    for (const body of [
      { kind: 'component', space: null, days: 30 },
      { kind: null, space: id, days: null },
      { kind: 'document', space: id, days: 36500 },
    ]) {
      expect(RetentionBody.safeParse(body).success, JSON.stringify(body)).toBe(true);
    }
    for (const body of [
      { kind: null, space: null, days: 30 },
      { kind: 'publication', space: null, days: 30 },
      { kind: 'component', space: null, days: 0 },
      { kind: 'component', space: null, days: 1.5 },
      { kind: 'component', space: null, days: 36501 },
      { kind: 'component', space: 'not-an-id', days: 30 },
      { kind: 'component', days: 30 },
    ]) {
      expect(RetentionBody.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});
