import { describe, expect, it } from 'vitest';
import { ComponentVersionList } from './components.js';
import { routes } from './routes.js';

describe("a component's restore in the contract (the RS plan, RS-D)", () => {
  it('previews and restores by edit on the component, the restore naming the latest it was previewed against', () => {
    const preview = routes.previewRestore;
    const restore = routes.restoreVersion;
    expect([preview.method, preview.path]).toEqual([
      'GET',
      '/v1/components/{id}/versions/{version}/restoration',
    ]);
    expect([restore.method, restore.path]).toEqual([
      'POST',
      '/v1/components/{id}/versions/{version}/restore',
    ]);
    for (const route of [preview, restore]) {
      expect(route.access).toEqual({
        check: 'permission',
        permission: 'edit',
        target: { artifact: 'id' },
      });
    }
    expect(restore.body.safeParse({ latest: '00000000-0000-4000-8000-000000000001' }).success).toBe(
      true,
    );
    expect(restore.body.safeParse({}).success).toBe(false);
    expect(restore.responses[409]).toBeDefined();
  });

  it('lists each version with what it was restored from, or null', () => {
    const listed = {
      id: 'v3',
      number: '0.3',
      createdAt: '2026-10-12T09:00:00.000Z',
      author: null,
      note: null,
      restoredFrom: { id: 'v1', number: '0.1' },
    };
    expect(ComponentVersionList.parse({ items: [listed], next: null }).items[0]).toEqual(listed);
  });
});

describe("a document's versions and restore in the contract (the RS plan, RS-H)", () => {
  it("lists a document's versions to a reader, and previews and restores them by edit", () => {
    expect([routes.listDocumentVersions.method, routes.listDocumentVersions.path]).toEqual([
      'GET',
      '/v1/documents/{id}/versions',
    ]);
    expect(routes.listDocumentVersions.access).toMatchObject({ permission: 'read' });
    const preview = routes.previewDocumentRestore;
    const restore = routes.restoreDocumentVersion;
    expect([preview.method, preview.path]).toEqual([
      'GET',
      '/v1/documents/{id}/versions/{version}/restoration',
    ]);
    expect([restore.method, restore.path]).toEqual([
      'POST',
      '/v1/documents/{id}/versions/{version}/restore',
    ]);
    for (const route of [preview, restore]) {
      expect(route.access).toMatchObject({ permission: 'edit', target: { artifact: 'id' } });
    }
    expect(restore.body.safeParse({}).success).toBe(false);
  });
});
