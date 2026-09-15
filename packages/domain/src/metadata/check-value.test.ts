import { describe, expect, it } from 'vitest';

import { checkValue } from './check-value.js';
import { DEFINITION_SCHEMA_VERSION } from './definition.js';
import { fieldDefinitionSchema, type FieldDefinition } from './field.js';

const fieldOf = (
  dataType: string,
  validation: Record<string, unknown> = {},
  cardinality: Record<string, unknown> = { multiplicity: 'one' },
): FieldDefinition =>
  fieldDefinitionSchema.parse({
    schemaVersion: DEFINITION_SCHEMA_VERSION,
    id: `field-${dataType}`,
    name: `A ${dataType} field`,
    dataType,
    validation,
    ...cardinality,
  });

const many = (dataType: string, validation: Record<string, unknown> = {}, maxValues?: number) =>
  fieldOf(dataType, validation, {
    multiplicity: 'many',
    ...(maxValues === undefined ? {} : { maxValues }),
  });

/** The codes alone, so each test says exactly which rules fired and no others. */
const codes = (field: FieldDefinition, value: unknown) =>
  checkValue(field, value).map((each) => each.code);

describe('checkValue', () => {
  it('MET-004 takes the field and the value and nothing else', () => {
    expect(checkValue.length).toBe(2);
    const field = fieldOf('text', { maxLength: 5 });
    // The same value for the same field, asked twice as two artifacts would ask it.
    expect(checkValue(field, 'Grace Hopper')).toEqual(checkValue(field, 'Grace Hopper'));
  });

  it('MET-022 names the field, the rule and a stable code, and no schema for a rule the field owns', () => {
    expect(checkValue(fieldOf('text', { maxLength: 3 }), 'Alice')).toEqual([
      {
        code: 'metadata.maxLength',
        field: 'field-text',
        rule: 'maxLength',
        schemas: [],
        detail: 'Is longer than 3 characters',
      },
    ]);
  });

  it('fails type for a value that is not the JSON its data type takes', () => {
    const wrong: [string, unknown, unknown][] = [
      ['text', 42, 'Ada'],
      ['number', 0.1, '0.1'],
      ['number', '1.50', '1.5'],
      ['date', '15/09/2026', '2026-09-15'],
      ['time', '9am', '09:00'],
      ['dateTime', '2026-09-15T09:00', '2026-09-15T09:00Z'],
      ['boolean', 'true', true],
      ['user', 'user-ada', { user: 'user-ada' }],
      ['user', { user: 'user-ada', name: 'Ada' }, { user: 'user-ada' }],
    ];
    for (const [dataType, bad, good] of wrong) {
      expect(codes(fieldOf(dataType), bad), `${dataType} ${JSON.stringify(bad)}`).toEqual([
        'metadata.type',
      ]);
      expect(codes(fieldOf(dataType), good), `${dataType} ${JSON.stringify(good)}`).toEqual([]);
    }
  });

  it('MET-028 fails type for a date or a time with an offset, and a date and time without one', () => {
    expect(codes(fieldOf('date'), '2026-09-15+01:00')).toEqual(['metadata.type']);
    expect(codes(fieldOf('time'), '09:00Z')).toEqual(['metadata.type']);
    expect(codes(fieldOf('dateTime'), '2026-09-15T09:00')).toEqual(['metadata.type']);
    expect(codes(fieldOf('dateTime'), '2026-09-15T09:00-05:00')).toEqual([]);
  });

  it('MET-030 treats null on a one field and an empty list on a many field as a clear, not a failure', () => {
    expect(codes(fieldOf('text'), null)).toEqual([]);
    expect(codes(many('text'), [])).toEqual([]);
  });

  it('MET-030 fails multiplicity for a list on a one field, and a single value on a many field', () => {
    expect(codes(fieldOf('text'), ['Ada'])).toEqual(['metadata.multiplicity']);
    expect(codes(many('text'), 'Ada')).toEqual(['metadata.multiplicity']);
    expect(codes(many('text'), null)).toEqual(['metadata.multiplicity']);
  });

  it('MET-030 fails multiplicity for a value held twice, after normalisation', () => {
    expect(codes(many('text'), ['Ada', 'Grace'])).toEqual([]);
    expect(codes(many('text'), ['Ada', 'Grace', 'Ada'])).toEqual(['metadata.multiplicity']);
    expect(codes(many('text'), ['café', 'café'])).toEqual(['metadata.multiplicity']);
    expect(codes(many('time'), ['09:00', '09:00:00'])).toEqual(['metadata.multiplicity']);
    expect(codes(many('dateTime'), ['2026-09-15T10:00+01:00', '2026-09-15T09:00Z'])).toEqual([
      'metadata.multiplicity',
    ]);
    expect(codes(many('user'), [{ user: 'user-ada' }, { user: 'user-ada' }])).toEqual([
      'metadata.multiplicity',
    ]);
  });

  it('MET-030 keeps a many value in the order given, and reports a repeat by position', () => {
    const [repeat] = checkValue(many('text'), ['Grace', 'Ada', 'Grace']);
    expect(repeat?.detail).toBe('Value 3 repeats value 1');
  });

  it('MET-030 fails maxValues for more values than the field declares', () => {
    expect(codes(many('text', {}, 2), ['Ada', 'Grace'])).toEqual([]);
    expect(codes(many('text', {}, 2), ['Ada', 'Grace', 'Alice'])).toEqual(['metadata.maxValues']);
  });

  it('MET-004 fails minLength and maxLength, counting characters of the NFC form', () => {
    const field = fieldOf('text', { minLength: 2, maxLength: 4 });
    expect(codes(field, 'A')).toEqual(['metadata.minLength']);
    expect(codes(field, 'Grace')).toEqual(['metadata.maxLength']);
    expect(codes(field, 'Ada')).toEqual([]);
    expect(codes(field, 'café')).toEqual([]);
  });

  it('MET-004 fails min and max on a number, compared exactly', () => {
    const field = fieldOf('number', { min: '0.1', max: '9007199254740993' });
    expect(codes(field, '0.09')).toEqual(['metadata.min']);
    expect(codes(field, '9007199254740994')).toEqual(['metadata.max']);
    expect(codes(field, '0.1')).toEqual([]);
    expect(codes(field, '9007199254740993')).toEqual([]);
  });

  it('MET-004 fails integer and scale on a number', () => {
    expect(codes(fieldOf('number', { integer: true }), '2.5')).toEqual(['metadata.integer']);
    expect(codes(fieldOf('number', { integer: true }), '-3')).toEqual([]);
    expect(codes(fieldOf('number', { scale: 2 }), '1.125')).toEqual(['metadata.scale']);
    expect(codes(fieldOf('number', { scale: 2 }), '1.12')).toEqual([]);
  });

  it('MET-004 fails min and max on a date and a time', () => {
    const date = fieldOf('date', { min: '2026-01-01', max: '2026-12-31' });
    expect(codes(date, '2025-12-31')).toEqual(['metadata.min']);
    expect(codes(date, '2027-01-01')).toEqual(['metadata.max']);
    expect(codes(date, '2026-06-30')).toEqual([]);
    const time = fieldOf('time', { min: '09:00', max: '17:30' });
    expect(codes(time, '08:59:59')).toEqual(['metadata.min']);
    expect(codes(time, '17:30:01')).toEqual(['metadata.max']);
    expect(codes(time, '09:00:00')).toEqual([]);
  });

  it('MET-028 compares date and time bounds as instants, whatever the offset', () => {
    const field = fieldOf('dateTime', { min: '2026-09-15T09:00Z' });
    expect(codes(field, '2026-09-15T09:30+01:00')).toEqual(['metadata.min']);
    expect(codes(field, '2026-09-15T05:00-04:00')).toEqual([]);
  });

  it('MET-030 checks every value of a many field, naming each by position', () => {
    const failures = checkValue(many('text', { maxLength: 3 }), ['Ada', 'Grace', 7]);
    expect(failures.map((each) => [each.code, each.detail])).toEqual([
      ['metadata.maxLength', 'Value 2: Is longer than 3 characters'],
      ['metadata.type', 'Value 3: Is not text'],
    ]);
  });

  it('keeps a decimal exactly as written, where a float would change it', () => {
    const field = fieldOf('number');
    for (const value of ['9007199254740993', '0.1000000000000000055', '1234567890.123456789012']) {
      // The premise: each of these is a value a binary float cannot hold.
      expect(String(Number(value)), value).not.toBe(value);
      expect(codes(field, value), value).toEqual([]);
    }
  });
});
