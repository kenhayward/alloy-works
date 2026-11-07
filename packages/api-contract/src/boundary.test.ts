import { OUTBOUND } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { allRoutes } from './routes.js';

describe('the routes that change each way out (the SA plan, SAe)', () => {
  it('ADM-041 names, for each way out, an operation that exists and the permission it needs', () => {
    for (const each of OUTBOUND) {
      if (each.changedBy === null) continue;
      const route = allRoutes.find((one) => one.operationId === each.changedBy!.operation);
      expect(route, each.way).toBeDefined();
      expect(route!.access, each.way).toMatchObject({ permission: each.changedBy.permission });
    }
  });
});
