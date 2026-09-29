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
      ).parameters
        .filter((parameter) => parameter.in !== 'header')
        .map(({ name, in: where, required }) => [name, where, required]);
    const paged = [
      ['cursor', 'query', false],
      ['limit', 'query', false],
      ['sort', 'query', false],
      ['order', 'query', false],
    ];
    // Each listing's filters (SCH-064): they narrow what is paged, never an offset into it.
    const filters = (...names: string[]) => names.map((name) => [name, 'query', false]);
    expect(parameters('/v1/components')).toEqual([...paged, ...filters('types', 'spaces')]);
    expect(parameters('/v1/documents')).toEqual([...paged, ...filters('spaces', 'publishing')]);
    expect(parameters('/v1/publications')).toEqual([...paged, ...filters('spaces', 'documents')]);
    expect(parameters('/v1/templates')).toEqual([...paged, ...filters('spaces')]);
    expect(parameters('/v1/documents/{id}/publications')).toEqual([
      ['id', 'path', true],
      ...paged,
      ...filters('spaces', 'documents'),
    ]);
  });
});
