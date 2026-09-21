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

  it('pages a listing by an opaque cursor and a limit, never an offset', () => {
    const document = buildOpenApi(allRoutes);
    const listing = document.paths['/v1/components']?.get as {
      parameters: { name: string; in: string; required: boolean }[];
    };
    expect(
      listing.parameters.map(({ name, in: where, required }) => [name, where, required]),
    ).toEqual([
      ['cursor', 'query', false],
      ['limit', 'query', false],
      // The space facet's filter (interface slice 3): narrows what is paged, never an offset into it.
      ['spaces', 'query', false],
    ]);
  });
});
