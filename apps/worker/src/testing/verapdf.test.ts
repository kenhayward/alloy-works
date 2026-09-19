import { describe, expect, it } from 'vitest';
import { verdictOf } from './verapdf.js';

describe('reading a veraPDF report', () => {
  it('refuses a report with no validation result, naming the exit code', () => {
    // What veraPDF prints when it could not parse the file: a job, and no validation result.
    const report = JSON.stringify({ report: { jobs: [{ taskException: [{}] }] } });

    expect(() => verdictOf(report, 1)).toThrow('veraPDF produced no validation result (exit 1)');
  });
});
