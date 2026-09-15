import { describe, expect, it } from 'vitest';

import {
  canonicaliseDecimal,
  compareDecimal,
  dateTimeInstant,
  decimalScale,
  isCanonicalDecimal,
  isIsoDate,
  isIsoTime,
  timeKey,
} from './lexical.js';

describe('the lexical forms of metadata values', () => {
  it('MET-002 holds a number as a canonical decimal string, never a JSON number', () => {
    for (const value of ['0', '7', '-7', '0.1', '-0.25', '120', '9007199254740993']) {
      expect(isCanonicalDecimal(value), value).toBe(true);
    }
    for (const value of ['', '-0', '007', '1.50', '.5', '5.', '1e3', '+1', ' 1', '0x10']) {
      expect(isCanonicalDecimal(value), value).toBe(false);
    }
  });

  it('MET-002 canonicalises a number as entered without changing its value', () => {
    expect(canonicaliseDecimal('007.50')).toBe('7.5');
    expect(canonicaliseDecimal('-0.000')).toBe('0');
    expect(canonicaliseDecimal('.5')).toBe('0.5');
    expect(canonicaliseDecimal('+12.')).toBe('12');
    expect(canonicaliseDecimal('9007199254740993.10')).toBe('9007199254740993.1');
    expect(canonicaliseDecimal('1e3')).toBeUndefined();
    expect(canonicaliseDecimal('.')).toBeUndefined();
  });

  it('MET-002 compares decimals exactly, beyond what a float can hold', () => {
    expect(compareDecimal('9007199254740993', '9007199254740992')).toBeGreaterThan(0);
    expect(compareDecimal('0.1', '0.10000000000000001')).toBeLessThan(0);
    expect(compareDecimal('-2', '-10')).toBeGreaterThan(0);
    expect(compareDecimal('-0.5', '0.5')).toBeLessThan(0);
    expect(compareDecimal('12.5', '12.5')).toBe(0);
    expect(decimalScale('12.345')).toBe(3);
    expect(decimalScale('12')).toBe(0);
  });

  it('MET-028 refuses a date or a time carrying an offset', () => {
    expect(isIsoDate('2026-09-15')).toBe(true);
    expect(isIsoDate('2026-09-15Z')).toBe(false);
    expect(isIsoDate('2026-09-15+01:00')).toBe(false);
    expect(isIsoTime('09:30')).toBe(true);
    expect(isIsoTime('09:30:15')).toBe(true);
    expect(isIsoTime('09:30Z')).toBe(false);
    expect(isIsoTime('09:30:15+01:00')).toBe(false);
  });

  it('MET-002 refuses a date that is not a calendar day, and a time that is not a time of day', () => {
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('1900-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('0000-01-01')).toBe(false);
    expect(isIsoTime('24:00')).toBe(false);
    expect(isIsoTime('09:60')).toBe(false);
    expect(timeKey('09:00')).toBe(timeKey('09:00:00'));
  });

  it('MET-028 requires an offset or Z on a date and time, and reads it as one instant', () => {
    expect(dateTimeInstant('1970-01-01T00:00Z')).toBe(0n);
    expect(dateTimeInstant('2026-09-15T10:00+01:00')).toBe(dateTimeInstant('2026-09-15T09:00Z'));
    expect(dateTimeInstant('2026-09-15T09:00:00.5Z')).toBe(
      (dateTimeInstant('2026-09-15T09:00Z') ?? 0n) + 500_000_000n,
    );
    expect(dateTimeInstant('2026-09-15T09:00')).toBeUndefined();
    expect(dateTimeInstant('2026-02-30T09:00Z')).toBeUndefined();
    expect(dateTimeInstant('2026-09-15 09:00Z')).toBeUndefined();
  });
});
