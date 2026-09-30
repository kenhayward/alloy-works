import { describe, expect, it } from 'vitest';

import { dataFailure, dataFailureCodes, dataFailures } from './failures.js';

describe('a data failure', () => {
  it('DAT-049 fixes the attribution of every data failure by its code', () => {
    // data.md's table, "Failures", precision_lost's kin spelled out; then D1-Q's three, and D1-M's
    // source_unsupported, which a test answers once it has authenticated.
    expect(dataFailures).toEqual({
      connection_failed: 'connector',
      address_refused: 'connector',
      timeout: 'connector',
      row_limit: 'query',
      byte_limit: 'query',
      result_incomplete: 'connector',
      result_mismatch: 'query',
      precision_lost: 'query',
      precision_not_carried: 'query',
      zone_missing: 'query',
      nonexistent_date: 'query',
      cell_error: 'query',
      nested_value: 'query',
      image_refused: 'query',
      empty_result: 'query',
      identity_unavailable: 'product',
      identity_expired: 'connector',
      identity_unmatched: 'connector',
      sql_not_permitted: 'product',
      parameter_invalid: 'product',
      binding_unresolved: 'product',
      connector_error: 'connector',
      connector_unavailable: 'product',
      connector_busy: 'product',
      source_unsupported: 'connector',
    });
    expect(new Set(dataFailureCodes).size).toBe(dataFailureCodes.length);
    for (const code of dataFailureCodes) {
      expect(['connector', 'query', 'product']).toContain(dataFailures[code]);
      // A failure is made from its code alone, so nothing can attribute it otherwise.
      expect(dataFailure(code)).toEqual({ code, attribution: dataFailures[code] });
    }
    expect(Object.isFrozen(dataFailures)).toBe(true);
  });
});
