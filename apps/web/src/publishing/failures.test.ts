import { publishFailureCodes } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { FAILURE_SUMMARIES, failureSummary } from './failures.js';

describe("a failure's summary, said where its place is not", () => {
  it('summarises every code a publish can fail with, in one sentence needing no detail', () => {
    expect(Object.keys(FAILURE_SUMMARIES).sort()).toEqual([...publishFailureCodes].sort());
    for (const code of publishFailureCodes) {
      const said = failureSummary(code);
      expect(said, code).toMatch(/^[A-Z].*\.$/);
      expect(said, code).not.toMatch(/ {2}|[–—]| - /);
      expect(said, code).not.toMatch(/\bhere\b|\bthis\b/i);
    }
  });

  it('says a code it does not know as a failed publish', () => {
    expect(failureSummary('something_new')).toBe('Its latest publish failed. Publish again.');
  });
});
