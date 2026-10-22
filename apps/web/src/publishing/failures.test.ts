import { publishFailureCodes } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { FAILURE_SUMMARIES, failureSummary, failureWords } from './failures.js';

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

describe("a citation's failure, in words (CIc)", () => {
  const at = (code: string, detail: string | null) =>
    failureWords({ stage: 'compose', code, node: null, block: 'p1', detail } as never);

  it('names the citation and its entry, the entry and the variable, and the style', () => {
    expect(at('citation_unresolved', '2: 0b0e2c4b')).toBe(
      'Citation 2 here names a bibliography entry you may not read, or one not in this space: 0b0e2c4b. Cite an entry of this space, or remove the citation.',
    );
    expect(at('entry_incomplete', '0b0e2c4b: container-title')).toBe(
      'The bibliography entry 0b0e2c4b lacks container-title, which the citation style needs for its type. Fill it in on the entry, and publish again.',
    );
    expect(at('style_invalid', 'none')).toBe(
      "The publication's theme names no citation style, so its citations cannot be set. Choose one in the theme.",
    );
    expect(at('style_invalid', 'render')).toBe(
      "The theme's citation style no longer sets citations. Choose another in the theme, or upload the style again.",
    );
  });
});
