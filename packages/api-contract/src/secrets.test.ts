import { SECRET_CONSUMERS } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { allRoutes } from './routes.js';

describe('the routes that replace each secret (secrets.md)', () => {
  it('ADM-047 names, for each kind of secret, an operation that exists and the permission it needs', () => {
    for (const each of SECRET_CONSUMERS) {
      const route = allRoutes.find((one) => one.operationId === each.operation);
      expect(route, each.kind).toBeDefined();
      expect(route!.access, each.kind).toMatchObject({ permission: each.permission });
    }
  });
});
