import { describe, expect, it } from 'vitest';
import { INTEGRITY_CLASSES, INTEGRITY_PERIOD_DAYS, integrityShare } from './integrity.js';

describe('integrity re-verified (the DG plan, DG-K)', () => {
  it('declares each class and the period within which every item is checked', () => {
    expect(INTEGRITY_CLASSES).toEqual(['asset', 'version', 'audit_export', 'tenant_export']);
    expect(INTEGRITY_PERIOD_DAYS).toBe(28);
  });

  it('checks a share a night, at least one while any exist, so all are checked within the period', () => {
    expect(integrityShare(0)).toBe(0);
    expect(integrityShare(1)).toBe(1);
    expect(integrityShare(28)).toBe(1);
    expect(integrityShare(29)).toBe(2);
    expect(integrityShare(2800)).toBe(100);
  });
});
