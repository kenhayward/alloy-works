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

  it('declares a 403 and a 404 on every route that checks a permission', () => {
    // Not just a query-targeted route (whose target may be the tenant, never refused as not found):
    // every permission-checked route can 404 an unreadable target and 403 a readable one refused
    // (final review, item 7).
    const checked = allRoutes.filter((route) => route.access.check === 'permission');
    expect(checked.length).toBeGreaterThan(0);
    for (const route of checked) {
      expect(route.responses[403], route.operationId).toBeDefined();
      expect(route.responses[404], route.operationId).toBeDefined();
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
