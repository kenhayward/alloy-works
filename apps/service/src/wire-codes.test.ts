import { describe, expect, it } from 'vitest';
import { wireCode } from './wire-codes.js';

describe('wireCode', () => {
  it("spells every dotted store answer with an underscore, the one shape the wire uses (Ken's decision F)", () => {
    expect(wireCode('lock.held')).toBe('lock_held');
    expect(wireCode('lock.required')).toBe('lock_required');
    expect(wireCode('iteration.stale')).toBe('iteration_stale');
    expect(wireCode('iteration.conflict')).toBe('iteration_conflict');
    expect(wireCode('version.precondition')).toBe('version_precondition');
    expect(wireCode('version.unchanged')).toBe('version_unchanged');
    expect(wireCode('content.invalid')).toBe('content_invalid');
    expect(wireCode('artifact.missing')).toBe('artifact_missing');
  });
});
