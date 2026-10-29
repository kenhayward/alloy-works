import { describe, expect, it } from 'vitest';

import { DEFINITION_SCHEMA_VERSION } from '../metadata/definition.js';
import type { FieldDefinition } from '../metadata/field.js';
import type { EffectiveField } from '../metadata/resolve.js';

import { mapProperties, type DecomposedProperty } from './properties.js';

const effective = (field: Record<string, unknown>): EffectiveField => ({
  field: {
    schemaVersion: DEFINITION_SCHEMA_VERSION,
    name: String(field.id),
    multiplicity: 'one',
    validation: {},
    ...field,
  } as FieldDefinition,
  required: false,
  requiredBy: [],
  fixed: false,
  fixedBy: [],
});

const prop = (name: string, value: string): DecomposedProperty => ({
  name,
  value,
  origin: 'core',
});

const fields = [
  effective({ id: 'title', dataType: 'text' }),
  effective({ id: 'pages', dataType: 'number' }),
  effective({ id: 'issued', dataType: 'date' }),
  effective({ id: 'at', dataType: 'time' }),
  effective({ id: 'stamp', dataType: 'dateTime' }),
  effective({ id: 'draft', dataType: 'boolean' }),
  effective({ id: 'owner', dataType: 'user' }),
  effective({ id: 'tags', dataType: 'text', multiplicity: 'many' }),
  effective({ id: 'short', dataType: 'text', validation: { maxLength: 3 } }),
];

describe('document properties to metadata values', () => {
  it('API-073 converts each mapped property to its field data type', () => {
    const { values, carried, unmapped } = mapProperties(
      [
        prop('Title', 'Annual report'),
        prop('Pages', ' 007.50 '),
        prop('Date', '2026-10-29'),
        prop('Time', '09:30'),
        prop('Stamp', '2026-10-29T09:30:00+01:00'),
      ],
      { Title: 'title', Pages: 'pages', Date: 'issued', Time: 'at', Stamp: 'stamp' },
      fields,
    );
    expect(values).toEqual({
      title: 'Annual report',
      pages: '7.5',
      issued: '2026-10-29',
      at: '09:30',
      stamp: '2026-10-29T09:30:00+01:00',
    });
    expect(carried).toEqual([]);
    expect(unmapped).toEqual([]);
  });

  it.each([
    ['true', true],
    ['Yes', true],
    ['FALSE', false],
    ['no', false],
  ])('converts the boolean %s', (text, expected) => {
    expect(mapProperties([prop('D', text)], { D: 'draft' }, fields).values).toEqual({
      draft: expected,
    });
  });

  it('API-073 an unconvertible number is left unset and reported', () => {
    const result = mapProperties(
      [prop('Pages', '1e3'), prop('Date', '29/10/2026')],
      { Pages: 'pages', Date: 'issued' },
      fields,
    );
    expect(result.values).toEqual({});
    expect(result.carried.map((entry) => [entry.code, entry.element])).toEqual([
      ['property_unconverted', 'Pages'],
      ['property_unconverted', 'Date'],
    ]);
    expect(result.unmapped).toEqual([]);
  });

  it('API-073 reports a value the field own validation refuses', () => {
    const result = mapProperties([prop('S', 'long text')], { S: 'short' }, fields);
    expect(result.values).toEqual({});
    expect(result.carried[0]).toMatchObject({ code: 'property_unconverted', element: 'S' });
  });

  it('API-073 a property with no mapping, or a field the template lacks, is unmapped', () => {
    const lone = prop('Author', 'A');
    const lost = prop('Lost', 'B');
    const result = mapProperties([lone, lost], { Lost: 'gone' }, fields);
    expect(result.unmapped).toEqual([lone, lost]);
    expect(result.carried.map((entry) => [entry.code, entry.element])).toEqual([
      ['property_unmapped', 'Author'],
      ['property_unmapped', 'Lost'],
    ]);
    expect(result.values).toEqual({});
  });

  it('a user field is never filled from a property', () => {
    const owner = prop('Owner', 'alice');
    const result = mapProperties([owner], { Owner: 'owner' }, fields);
    expect(result.values).toEqual({});
    expect(result.unmapped).toEqual([owner]);
    expect(result.carried[0]).toMatchObject({ code: 'property_unmapped', element: 'Owner' });
  });

  it('gathers several properties into a field holding many, and keeps the first for one', () => {
    const result = mapProperties(
      [prop('K1', 'a'), prop('K2', 'b'), prop('K3', 'a'), prop('T1', 'x'), prop('T2', 'y')],
      { K1: 'tags', K2: 'tags', K3: 'tags', T1: 'title', T2: 'title' },
      fields,
    );
    expect(result.values).toEqual({ tags: ['a', 'b'], title: 'x' });
    expect(result.carried.map((entry) => [entry.code, entry.element])).toEqual([
      ['property_unconverted', 'K3'],
      ['property_unconverted', 'T2'],
    ]);
  });

  it('does not take an inherited object member as a mapping', () => {
    expect(mapProperties([prop('constructor', 'x')], {}, fields).unmapped).toHaveLength(1);
  });
});
