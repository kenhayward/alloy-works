import { defaultLimits } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { finishResult } from './result.js';

/**
 * `finishResult`, pure: no source, no child. A bound table's empty result (tables.md, DAT-069) is
 * decided here, before anything is kept: declared valid, it is a result like any; declared invalid,
 * the run fails as any failed run, and nothing is kept for a table to print.
 */
describe('finishResult', () => {
  const definition = (empty: 'valid' | 'invalid') => ({
    columns: [
      { name: 'site', from: { column: 'site' }, type: { base: 'text' as const } },
      { name: 'reading', from: { column: 'reading' }, type: { base: 'integer' as const } },
    ],
    key: ['site'],
    order: [{ column: 'site', direction: 'ascending' as const }],
    empty,
  });

  it('DAT-069 keeps an empty result its definition declares valid, and fails one declared invalid as a failed run, empty_result, keeping nothing', () => {
    const valid = finishResult([], definition('valid'), defaultLimits);
    expect(valid).toMatchObject({ result: { rows: [] }, rowCount: 0 });
    const invalid = finishResult([], definition('invalid'), defaultLimits);
    expect(invalid).toMatchObject({ failure: { code: 'empty_result' } });
    expect(invalid).not.toHaveProperty('result');
    // A result with rows is kept whichever its definition declares.
    expect(finishResult([['North', '1']], definition('invalid'), defaultLimits)).toMatchObject({
      rowCount: 1,
    });
  });
});
