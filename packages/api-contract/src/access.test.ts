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
      if ('body' in target) {
        expect(route.body?.shape, route.operationId).toHaveProperty(target.body);
      }
      if ('artifactVersion' in target) {
        expect(route.path, route.operationId).toContain(`{${target.artifactVersion}}`);
        expect(route.params?.shape, route.operationId).toHaveProperty(target.artifactVersion);
      }
      if ('grant' in target) {
        expect(route.path, route.operationId).toContain(`{${target.grant}}`);
        expect(route.params?.shape, route.operationId).toHaveProperty(target.grant);
      }
    }
  });

  it('declares a 403 and a 404 on every route that checks a permission', () => {
    // Not just a query-targeted route (whose target may be the tenant, never refused as not found):
    // every permission-checked route can 404 an unreadable target and 403 a readable one refused
    // (final review, item 7) - except a route whose target is a grant, which a caller who may not
    // manage it is always told is simply not there (access.md, "Refusing"), never 403.
    // A route whose target is the tenant itself is the other exception: the tenant always exists, so
    // asking of it is never 404 (access.md, "Refusing"), and such a route declares a 404 only where its
    // own handler answers one.
    const checked = allRoutes.filter((route) => route.access.check === 'permission');
    expect(checked.length).toBeGreaterThan(0);
    for (const route of checked) {
      if (route.access.check !== 'permission') continue;
      if (!('grant' in route.access.target)) {
        expect(route.responses[403], route.operationId).toBeDefined();
      }
      if (!('tenant' in route.access.target)) {
        expect(route.responses[404], route.operationId).toBeDefined();
      }
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
