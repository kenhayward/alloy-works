import { describe, expect, it } from 'vitest';
import { ErasureView, PrincipalList } from './index.js';
import { routes } from './routes.js';

describe('erasure in the contract (the ER plan, ER-C)', () => {
  it('states and erases by administer at the tenant', () => {
    const administer = { check: 'permission', permission: 'administer', target: { tenant: true } };
    expect(routes.getErasure.access).toEqual(administer);
    // Erasing removes their memberships, a fact a decision reads.
    expect(routes.erasePrincipal.access).toEqual({
      ...administer,
      changesAccess: true,
      credential: 'session',
    });
    const paths = [routes.getErasure, routes.erasePrincipal].map(
      (route) => `${route.method} ${route.path}`,
    );
    expect(paths).toEqual(['GET /v1/principals/{id}/erasure', 'POST /v1/principals/{id}/erase']);
  });

  it('states what is erased, what remains and every refusal, and lists the erased as such', () => {
    const view = {
      person: { id: 'p1', kind: 'user', invited: false, erased: false },
      erases: { sessions: 2, tokens: 1, memberships: 0, invitation: true, labels: 9 },
      remains: { events: 14 },
      refusals: [{ code: 'granted', grants: 2 }, { code: 'self' }],
    };
    expect(ErasureView.parse(view)).toEqual(view);
    expect(ErasureView.safeParse({ ...view, refusals: [{ code: 'held' }] }).success).toBe(false);
    expect(
      PrincipalList.parse({
        items: [
          {
            id: 'p1',
            name: 'Erased person',
            email: null,
            kind: 'user',
            invited: false,
            erased: true,
          },
        ],
        next: null,
        total: 1,
      }).items[0]!.erased,
    ).toBe(true);
  });
});
