import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, compile } from './compile.js';
import { parseBaseline } from './parse/baseline.js';

/**
 * The first real baseline - `0.13.0.md` - read and asserted the way `design.test.ts` asserts the
 * real design documents. This is not a fixture: it is the actual committed declaration of what
 * release 0.13.0 is answerable for, and these are the things a person would otherwise have to
 * remember to check by eye every time the document changes.
 */
const document = '0.13.0.md';
const baselineDir = join(REPO_ROOT, 'docs', 'specification', 'baselines');
const baseline = parseBaseline(document, readFileSync(join(baselineDir, document), 'utf8'));

const model = compile(REPO_ROOT);
const requirementById = new Map(
  model.requirements.map((requirement) => [requirement.id, requirement]),
);

describe('the 0.13.0 baseline', () => {
  it('includes only requirements that exist and are in force', () => {
    for (const inclusion of baseline.included) {
      const requirement = requirementById.get(inclusion.id);
      expect(requirement, `${inclusion.id} should exist in the corpus`).toBeDefined();
      expect(requirement?.status, `${inclusion.id} should be Specified`).toBe('Specified');
    }
  });

  it('gives every exclusion a reason', () => {
    expect(baseline.excluded.length).toBeGreaterThan(0);
    for (const exclusion of baseline.excluded) {
      expect(exclusion.reason.trim().length).toBeGreaterThan(0);
    }
  });

  // A reason a schema accepts and a reason a reader would accept are different things: `min(1)` at
  // parse time lets "later" through, which is exactly how an exclusion gets waved through without
  // anyone having actually named what is missing. This is a floor, not a style rule - every reason
  // in the real document should clear it by a wide margin.
  it('gives every exclusion a reason substantial enough to not be a placeholder', () => {
    for (const exclusion of baseline.excluded) {
      expect(
        exclusion.reason.trim().length,
        `${exclusion.id}'s reason should be a real explanation, not a placeholder`,
      ).toBeGreaterThanOrEqual(40);
    }
  });

  it('excludes nothing it also includes', () => {
    const includedIds = new Set(baseline.included.map((inclusion) => inclusion.id));
    const excludedIds = baseline.excluded.map((exclusion) => exclusion.id);

    expect(excludedIds.filter((id) => includedIds.has(id))).toEqual([]);
  });

  it('names IAM-018 as excluded, with the rule-field ceiling as the reason', () => {
    const exclusion = baseline.excluded.find((row) => row.id === 'IAM-018');

    expect(exclusion).toBeDefined();
    expect(exclusion?.reason).toMatch(/rule:/);
    expect(exclusion?.reason).toMatch(/Covered/);
    expect(exclusion?.reason).toMatch(/never.*Verified|Verified/);
  });

  it('declares seven included requirements', () => {
    expect(baseline.included).toHaveLength(7);
  });
});
