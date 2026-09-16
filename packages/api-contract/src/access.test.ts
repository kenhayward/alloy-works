import { isPermission } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { buildOpenApi } from './openapi.js';
import { allRoutes } from './routes.js';

describe('what each route checks', () => {
  it('is declared by every route, as nothing, a session, or a permission and its target', () => {
    for (const route of allRoutes) {
      expect(['none', 'session', 'permission'], route.operationId).toContain(route.access?.check);
    }
  });

  it('names, for a permission, one from the closed set and a target the route itself carries', () => {
    expect(allRoutes.some((route) => route.access.check === 'permission')).toBe(true);
    for (const route of allRoutes) {
      if (route.access.check !== 'permission') continue;
      const { permission, target } = route.access;
      expect(isPermission(permission), route.operationId).toBe(true);
      expect(route.tenantScoped, route.operationId).toBe(true);
      if ('space' in target || 'artifact' in target) {
        const name = 'space' in target ? target.space : target.artifact;
        expect(route.path, route.operationId).toContain(`{${name}}`);
        expect(route.params?.shape, route.operationId).toHaveProperty(name);
      }
      if ('query' in target) {
        expect(route.query?.shape, route.operationId).toHaveProperty(target.query);
      }
    }
  });

  it('declares a 403 for every route whose target may be the tenant, which is never refused as not found', () => {
    const queryTargeted = allRoutes.filter(
      (route) => route.access.check === 'permission' && 'query' in route.access.target,
    );
    expect(queryTargeted.length).toBeGreaterThan(0);
    for (const route of queryTargeted) {
      expect(route.responses[403], route.operationId).toBeDefined();
    }
  });

  it('asks for a session in the published document exactly where a route checks anything', () => {
    const document = buildOpenApi(allRoutes);
    for (const route of allRoutes) {
      const operation = document.paths[route.path]?.[route.method.toLowerCase()] as {
        security: unknown[];
      };
      expect(operation.security, route.operationId).toEqual(
        route.access.check === 'none' ? [] : [{ session: [] }],
      );
    }
  });
});
