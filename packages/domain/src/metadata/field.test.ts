import { describe, expect, it } from 'vitest';

import { DEFINITION_SCHEMA_VERSION } from './definition.js';
import { dataTypes, fieldDefinitionSchema } from './field.js';

/** A copy of `value` without `member`, for a test that a member is required. */
const without = (value: Record<string, unknown>, member: string) =>
  Object.fromEntries(Object.entries(value).filter(([key]) => key !== member));

const field = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  schemaVersion: DEFINITION_SCHEMA_VERSION,
  id: 'field-study',
  name: 'Study number',
  dataType: 'text',
  multiplicity: 'one',
  validation: {},
  ...overrides,
});

describe('a field definition', () => {
  it('MET-001 carries an identifier, a name, a data type and its validation', () => {
    expect(fieldDefinitionSchema.parse(field({ validation: { maxLength: 20 } }))).toEqual(
      field({ validation: { maxLength: 20 } }),
    );
    for (const member of ['id', 'name', 'dataType', 'validation']) {
      expect(() => fieldDefinitionSchema.parse(without(field(), member)), member).toThrow();
    }
  });

  it('MET-002 closes the data types at the seven the requirement names', () => {
    expect([...dataTypes].sort()).toEqual(
      ['boolean', 'date', 'dateTime', 'number', 'text', 'time', 'user'].sort(),
    );
    expect(() => fieldDefinitionSchema.parse(field({ dataType: 'vocabulary' }))).toThrow();
  });

  it('MET-002 makes a field declare whether it holds one value or several', () => {
    expect(fieldDefinitionSchema.parse(field({ multiplicity: 'many' })).multiplicity).toBe('many');
    expect(() => fieldDefinitionSchema.parse(without(field(), 'multiplicity'))).toThrow();
    expect(() => fieldDefinitionSchema.parse(field({ multiplicity: 'several' }))).toThrow();
  });

  it('MET-030 lets a field holding several values declare the most it may hold, and only that field', () => {
    expect(
      fieldDefinitionSchema.parse(field({ multiplicity: 'many', maxValues: 3 })).maxValues,
    ).toBe(3);
    expect(() => fieldDefinitionSchema.parse(field({ multiplicity: 'one', maxValues: 3 }))).toThrow(
      /maxValues/,
    );
    expect(() =>
      fieldDefinitionSchema.parse(field({ multiplicity: 'many', maxValues: 0 })),
    ).toThrow();
  });

  it('MET-004 declares validation per data type, and refuses a member another type takes', () => {
    expect(() =>
      fieldDefinitionSchema.parse(
        field({ dataType: 'number', validation: { min: '0', scale: 2 } }),
      ),
    ).not.toThrow();
    expect(() =>
      fieldDefinitionSchema.parse(field({ dataType: 'text', validation: { scale: 2 } })),
    ).toThrow();
    expect(() =>
      fieldDefinitionSchema.parse(field({ dataType: 'boolean', validation: { min: '0' } })),
    ).toThrow();
    expect(() =>
      fieldDefinitionSchema.parse(field({ dataType: 'user', validation: { maxLength: 4 } })),
    ).toThrow();
  });

  it('refuses a pattern on a text field, because no pattern ships until backtracking is bounded', () => {
    expect(() =>
      fieldDefinitionSchema.parse(field({ validation: { pattern: '^[A-Z]{3}-\\d{3}$' } })),
    ).toThrow();
  });

  it('writes a number bound as a canonical decimal string, never a JSON number', () => {
    expect(() =>
      fieldDefinitionSchema.parse(field({ dataType: 'number', validation: { min: 0 } })),
    ).toThrow();
    expect(() =>
      fieldDefinitionSchema.parse(field({ dataType: 'number', validation: { max: '1.50' } })),
    ).toThrow();
  });

  it('MET-028 writes a date bound with no offset, and a date and time bound with one', () => {
    expect(() =>
      fieldDefinitionSchema.parse(field({ dataType: 'date', validation: { min: '2026-01-01Z' } })),
    ).toThrow();
    expect(() =>
      fieldDefinitionSchema.parse(
        field({ dataType: 'dateTime', validation: { min: '2026-01-01T00:00' } }),
      ),
    ).toThrow();
    expect(() =>
      fieldDefinitionSchema.parse(
        field({ dataType: 'dateTime', validation: { min: '2026-01-01T00:00+01:00' } }),
      ),
    ).not.toThrow();
  });

  it('MET-001 records the definition schema version it was written against', () => {
    expect(() => fieldDefinitionSchema.parse(field({ schemaVersion: 99 }))).toThrow();
  });
});
