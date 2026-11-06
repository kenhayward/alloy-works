import { describe, expect, it } from 'vitest';
import { USAGE_MEASURES, daysToCount } from './usage.js';

describe('usage counted by day (the DG plan, DG-I; ADR-0100)', () => {
  it('ADM-035 declares each measure, its kind and its unit before anything is counted', () => {
    expect(USAGE_MEASURES.map((each) => each.measure)).toEqual([
      'databaseBytes',
      'publicationBytes',
      'assetBytes',
      'importBytes',
      'exportBytes',
      'publications',
      'assets',
      'mail',
      'webhooks',
      'translationJobs',
      'referenceSearches',
      'embeddingRuns',
      'queryMs',
    ]);
    expect(
      USAGE_MEASURES.filter((each) => each.kind === 'sample').every(
        (each) => each.unit === 'bytes',
      ),
    ).toBe(true);
  });

  it('counts each day since the last, the last three again, never more than 30 days back', () => {
    expect(daysToCount(null, '2026-11-06')).toHaveLength(30);
    expect(daysToCount(null, '2026-11-06')[0]).toBe('2026-10-07');
    expect(daysToCount('2026-11-05', '2026-11-06')).toEqual([
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
    ]);
    expect(daysToCount('2026-10-31', '2026-11-06')).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
    ]);
    expect(daysToCount('2026-01-01', '2026-11-06')).toHaveLength(30);
  });
});
