import { describe, expect, it } from 'vitest';
import { HoldBody, ReleaseHoldBody } from './holds.js';
import { routes } from './routes.js';

describe('legal holds in the contract (the AH plan, AH-F and AH-G)', () => {
  it('places, releases and lists holds by administer at the tenant', () => {
    const paths = [routes.placeHold, routes.releaseHold, routes.listHolds].map((route) => {
      expect(route.access).toEqual({
        check: 'permission',
        permission: 'administer',
        target: { tenant: true },
      });
      return `${route.method} ${route.path}`;
    });
    expect(paths).toEqual(['POST /v1/holds', 'POST /v1/holds/{id}/release', 'GET /v1/holds']);
  });

  it('takes an artifact or a space and a reason that is not empty', () => {
    const id = '0b6f6b8e-4a39-4c1e-9d0f-3c0a8f1e2d41';
    expect(HoldBody.parse({ target: { artifact: id }, reason: ' Matter ' }).reason).toBe('Matter');
    expect(HoldBody.safeParse({ target: { space: id }, reason: 'Matter' }).success).toBe(true);
    for (const body of [
      { target: { artifact: id }, reason: '   ' },
      { target: { artifact: id, space: id }, reason: 'Both' },
      { target: {}, reason: 'Neither' },
      { target: { artifact: 'not-an-id' }, reason: 'Matter' },
    ]) {
      expect(HoldBody.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
    expect(ReleaseHoldBody.safeParse({ reason: '' }).success).toBe(false);
    expect(ReleaseHoldBody.parse({ reason: 'Closed ' }).reason).toBe('Closed');
  });
});
