import { describe, expect, it } from 'vitest';

import {
  dataFailure,
  dataFailureCodes,
  dataFailures,
  dataFailureSchema,
  sourceMessage,
} from './failures.js';

describe('a data failure', () => {
  it('DAT-049 fixes the attribution of every data failure by its code', () => {
    // data.md's table, "Failures", precision_lost's kin spelled out; then D1-Q's three, D1-M's
    // source_unsupported, which a test answers once it has authenticated, and D2-H's two.
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
      // D2-H's two: the source refused the author's statement, and a value no canonical form of its
      // declared type can hold.
      source_refused: 'query',
      value_unrepresentable: 'query',
      // The re-review's: a binding the binder refused, never sent.
      definition_unbindable: 'query',
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

describe('a failure as it crosses the interface', () => {
  it("carries the source's SQLSTATE and message for source_refused alone, and a column or a row where it names one", () => {
    const refused = {
      code: 'source_refused',
      attribution: 'query',
      source: { sqlstate: '42P01', message: 'relation "sample.nothing" does not exist' },
    };
    expect(dataFailureSchema.parse(refused)).toEqual(refused);
    expect(
      dataFailureSchema.safeParse({
        code: 'timeout',
        attribution: 'connector',
        source: refused.source,
      }).success,
    ).toBe(false);
    expect(
      dataFailureSchema.safeParse({ code: 'source_refused', attribution: 'query' }).success,
    ).toBe(false);
    expect(
      dataFailureSchema.safeParse({ ...refused, source: { sqlstate: '42p01', message: 'x' } })
        .success,
    ).toBe(false);
    expect(
      dataFailureSchema.safeParse({
        ...refused,
        source: { sqlstate: '42P01', message: 'x'.repeat(1001) },
      }).success,
    ).toBe(false);
    const mismatch = { code: 'result_mismatch', attribution: 'query', column: 'taken', row: 12 };
    expect(dataFailureSchema.parse(mismatch)).toEqual(mismatch);
    expect(dataFailureSchema.safeParse({ ...mismatch, row: 0 }).success).toBe(false);
    expect(dataFailureSchema.safeParse({ ...mismatch, column: '' }).success).toBe(false);
  });

  it('cuts a source message to 1,000 characters, a whole character at a time', () => {
    const astral = String.fromCodePoint(0x20bb7);
    expect(sourceMessage('x'.repeat(1500))).toHaveLength(1000);
    const cut = sourceMessage(astral.repeat(1500));
    expect([...cut]).toHaveLength(1000);
    expect(
      dataFailureSchema.safeParse({
        code: 'source_refused',
        attribution: 'query',
        source: { sqlstate: '22012', message: cut },
      }).success,
    ).toBe(true);
  });
});
