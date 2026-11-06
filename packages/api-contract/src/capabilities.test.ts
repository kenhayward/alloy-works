import { JOB_CAPABILITIES } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { documentationGroups } from './documentation.js';

describe('the capabilities Diagnostics measures (the DG plan, DG-C)', () => {
  it("names each of the worker's kinds of work apart from every route tag", () => {
    const tags = documentationGroups.flatMap((group) => group.tags.map((tag) => tag.name));
    expect(tags.length).toBeGreaterThan(30);
    for (const work of new Set(Object.values(JOB_CAPABILITIES))) {
      expect(tags, work).not.toContain(work);
    }
  });
});
