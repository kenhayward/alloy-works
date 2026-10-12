import { describe, expect, it } from 'vitest';
import { ComponentListQuery } from './components.js';
import { DocumentListQuery } from './documents.js';
import { routes } from './routes.js';

describe('archival in the contract (the AH plan, AH-A and AH-D)', () => {
  it('archives and unarchives a component or a document by retire on it', () => {
    const paths = [
      routes.archiveComponent,
      routes.unarchiveComponent,
      routes.archiveDocument,
      routes.unarchiveDocument,
    ].map((route) => {
      expect(route.access).toEqual({
        check: 'permission',
        permission: 'retire',
        target: { artifact: 'id' },
      });
      return `${route.method} ${route.path}`;
    });
    expect(paths).toEqual([
      'POST /v1/components/{id}/archive',
      'POST /v1/components/{id}/unarchive',
      'POST /v1/documents/{id}/archive',
      'POST /v1/documents/{id}/unarchive',
    ]);
  });

  it('lists only the archived when asked, and nothing else', () => {
    for (const query of [ComponentListQuery, DocumentListQuery]) {
      expect(query.parse({ archived: 'only' }).archived).toBe('only');
      expect(query.safeParse({ archived: 'true' }).success).toBe(false);
    }
  });
});
