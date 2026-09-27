import { describe, expect, it } from 'vitest';
import { buildOpenApi } from './openapi.js';
import { allRoutes, routes } from './routes.js';

describe('the routes that find and open components', () => {
  it('lists for any signed-in caller, filtered by what they may read, and opens by read', () => {
    expect(routes.listComponents.access).toEqual({ check: 'session' });
    expect(routes.getComponent.access).toEqual({
      check: 'permission',
      permission: 'read',
      target: { artifact: 'id' },
    });
  });

  it('pages every content listing by an opaque cursor, a limit and a sort, never an offset', () => {
    const document = buildOpenApi(allRoutes);
    const parameters = (path: string) =>
      (
        document.paths[path]?.get as {
          parameters: { name: string; in: string; required: boolean }[];
        }
      ).parameters.map(({ name, in: where, required }) => [name, where, required]);
    const paged = [
      ['cursor', 'query', false],
      ['limit', 'query', false],
      ['sort', 'query', false],
      ['order', 'query', false],
    ];
    // The space facet's filter (interface slice 3): narrows what is paged, never an offset into it.
    expect(parameters('/v1/components')).toEqual([...paged, ['spaces', 'query', false]]);
    for (const path of ['/v1/documents', '/v1/publications', '/v1/templates']) {
      expect(parameters(path), path).toEqual(paged);
    }
    expect(parameters('/v1/documents/{id}/publications')).toEqual([['id', 'path', true], ...paged]);
  });
});
