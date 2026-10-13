import { describe, expect, it } from 'vitest';
import type { RouteContract } from './contract.js';
import { routes } from './routes.js';

describe('deletion in the contract (the DL plan, DL-B to DL-E)', () => {
  it('deletes, undeletes and states what remains of a component or a document by retire on it', () => {
    const paths = [
      routes.deleteComponent,
      routes.undeleteComponent,
      routes.getComponentDeletion,
      routes.deleteDocument,
      routes.undeleteDocument,
      routes.getDocumentDeletion,
    ].map((route) => {
      expect(route.access).toMatchObject({
        check: 'permission',
        permission: 'retire',
        target: { artifact: 'id' },
      });
      return `${route.method} ${route.path}`;
    });
    expect(paths).toEqual([
      'POST /v1/components/{id}/delete',
      'POST /v1/components/{id}/undelete',
      'GET /v1/components/{id}/deletion',
      'POST /v1/documents/{id}/delete',
      'POST /v1/documents/{id}/undelete',
      'GET /v1/documents/{id}/deletion',
    ]);
  });

  it('reaches a deleted one only to undelete it and to say what remains of it', () => {
    const reaching = (Object.values(routes) as RouteContract[])
      .filter((route) => route.access.check === 'permission' && route.access.readsDeleted)
      .map((route) => route.operationId)
      .sort();
    expect(reaching).toEqual(
      [
        'getComponentDeletion',
        'getDocumentDeletion',
        'undeleteComponent',
        'undeleteDocument',
      ].sort(),
    );
    expect(routes.deleteComponent.responses[409]).toBeDefined();
    expect(routes.deleteDocument.responses[409]).toBeDefined();
  });
});
