import { describe, expect, it } from 'vitest';
import { auditFilterProblem, kindsMatching } from './query.js';

describe("the audit log's filters", () => {
  it('takes a kind the log holds, or a family of them by its prefix and a dot', () => {
    expect(auditFilterProblem({ kind: 'space.renamed' })).toBeNull();
    expect(auditFilterProblem({ kind: 'space.' })).toBeNull();
    expect(kindsMatching('authentication.')).toEqual([
      'authentication.sign_in_failed',
      'authentication.signed_in',
      'authentication.signed_out',
    ]);
    expect(kindsMatching('space.renamed')).toEqual(['space.renamed']);
  });

  it('refuses a kind the log does not hold, a prefix no kind has, and dates out of order', () => {
    expect(auditFilterProblem({ kind: 'space.painted' })).toBe('kind');
    expect(auditFilterProblem({ kind: 'nothing.' })).toBe('kind');
    expect(auditFilterProblem({ kind: 'space' })).toBe('kind');
    expect(
      auditFilterProblem({
        from: new Date('2026-10-02T00:00:00Z'),
        to: new Date('2026-10-01T00:00:00Z'),
      }),
    ).toBe('dates');
    expect(
      auditFilterProblem({
        from: new Date('2026-10-01T00:00:00Z'),
        to: new Date('2026-10-01T00:00:00Z'),
      }),
    ).toBeNull();
  });
});
