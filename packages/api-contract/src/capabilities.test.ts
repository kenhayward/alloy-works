import { JOB_CAPABILITIES, MEASURED_OPERATIONS } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { documentationGroups } from './documentation.js';
import { routes } from './routes.js';

describe('the capabilities Diagnostics measures (the DG plan, DG-C)', () => {
  it("names each of the worker's kinds of work apart from every route tag", () => {
    const tags = documentationGroups.flatMap((group) => group.tags.map((tag) => tag.name));
    expect(tags.length).toBeGreaterThan(30);
    for (const work of new Set(Object.values(JOB_CAPABILITIES))) {
      expect(tags, work).not.toContain(work);
    }
  });

  it('names each operation measured on its own apart from every route tag and kind of work, for a route that exists', () => {
    const tags = documentationGroups.flatMap((group) => group.tags.map((tag) => tag.name));
    const operations = Object.values(routes).map((route) => route.operationId);
    for (const [operation, measured] of Object.entries(MEASURED_OPERATIONS)) {
      expect(operations).toContain(operation);
      expect(tags).not.toContain(measured);
      expect(Object.values(JOB_CAPABILITIES)).not.toContain(measured);
    }
  });
});
