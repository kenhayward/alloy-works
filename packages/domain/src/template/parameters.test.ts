import { describe, expect, it } from 'vitest';

import { DEFINITION_SCHEMA_VERSION } from '../metadata/definition.js';
import { fieldDefinitionSchema, type FieldDefinition } from '../metadata/field.js';
import type { EffectiveField } from '../metadata/resolve.js';

import { TEMPLATE_SCHEMA_VERSION, templateDefinitionSchema } from './definition.js';
import {
  argumentRefusal,
  checkDocumentParameters,
  checkTemplateParameters,
  documentParametersSchema,
  seedable,
  seededValues,
  templateParameterSchema,
  type TemplateParameter,
} from './parameters.js';

const THEME = '4ae73bd5-0000-4000-8000-000000002866';
const LAYOUT = '1a7e0a2b-0000-4000-8000-00000000f501';
const SITE = 'f1e1d000-0000-4000-8000-000000000001';

/** A parameter, a required text one feeding arguments, unless `over` says otherwise. */
const parameter = (over: object = {}): TemplateParameter =>
  templateParameterSchema.parse({
    name: 'site',
    type: { base: 'text' },
    required: true,
    list: false,
    changeable: false,
    feeds: { arguments: true },
    ...over,
  });

const template = (parameters: unknown) => ({
  schemaVersion: TEMPLATE_SCHEMA_VERSION,
  name: 'Report',
  theme: THEME,
  layout: LAYOUT,
  schemas: [],
  outline: { sections: [] },
  changes: { add: true, remove: true, reorder: true },
  parameters,
});

const field = (dataType: string, over: object = {}, validation: object = {}): FieldDefinition =>
  fieldDefinitionSchema.parse({
    schemaVersion: DEFINITION_SCHEMA_VERSION,
    id: SITE,
    name: 'Site',
    dataType,
    multiplicity: 'one',
    validation,
    ...over,
  });

const effective = (definition: FieldDefinition, fixed = false): EffectiveField => ({
  field: definition,
  required: false,
  requiredBy: [],
  fixed,
  fixedBy: fixed ? ['schema'] : [],
});

describe("a template's parameters as declared", () => {
  it('are optional, at most 50, and each the query definition parameter with changeable and feeds', () => {
    expect(templateDefinitionSchema.safeParse(template(undefined)).success).toBe(true);
    const declared = templateDefinitionSchema.parse(
      template([
        parameter(),
        parameter({
          name: 'quarter',
          type: { base: 'integer' },
          required: false,
          permitted: { minimum: '1', maximum: '4' },
          changeable: true,
          feeds: { field: SITE, arguments: false },
        }),
      ]),
    );
    expect(declared.parameters?.[1]).toMatchObject({ changeable: true, feeds: { field: SITE } });
    const many = Array.from({ length: 51 }, (_, at) => parameter({ name: `p${at}` }));
    expect(templateDefinitionSchema.safeParse(template(many)).success).toBe(false);
  });

  it('refuse a variation, which selects SQL, by the strict shape', () => {
    expect(
      templateParameterSchema.safeParse({
        ...parameter(),
        variation: [{ key: 'a', sql: 'select 1' }],
      }).success,
    ).toBe(false);
    expect(templateParameterSchema.safeParse({ ...parameter(), feeds: undefined }).success).toBe(
      false,
    );
  });

  it('refuse a name declared twice', () => {
    const parsed = templateDefinitionSchema.safeParse(template([parameter(), parameter()]));
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['parameters', 1, 'name']);
  });

  it('refuse a permitted value or a range bound not in its type, by the query definition rule', () => {
    const permitted = templateDefinitionSchema.safeParse(
      template([parameter({ type: { base: 'integer' }, permitted: { values: ['1', '01'] } })]),
    );
    expect(permitted.error?.issues.map((each) => each.path)).toEqual([
      ['parameters', 0, 'permitted', 'values', 1],
    ]);
    const range = templateDefinitionSchema.safeParse(
      template([parameter({ type: { base: 'text' }, permitted: { minimum: 'a' } })]),
    );
    expect(range.success).toBe(false);
  });
});

describe('a seeded field taking its parameter', () => {
  const decimal = (scale: number) => ({ base: 'decimal', precision: 10, scale });
  const pairs: readonly (readonly [string, FieldDefinition, object, boolean])[] = [
    ['text to text', field('text'), { type: { base: 'text' } }, true],
    ['integer to number', field('number'), { type: { base: 'integer' } }, true],
    [
      'integer to a whole number',
      field('number', {}, { integer: true }),
      { type: { base: 'integer' } },
      true,
    ],
    ['decimal to number', field('number'), { type: decimal(2) }, true],
    ['decimal into a wider scale', field('number', {}, { scale: 3 }), { type: decimal(2) }, true],
    [
      'decimal into a narrower scale',
      field('number', {}, { scale: 2 }),
      { type: decimal(3) },
      false,
    ],
    [
      'decimal into a whole number',
      field('number', {}, { integer: true }),
      { type: decimal(2) },
      false,
    ],
    [
      'decimal of scale 0 into a whole number',
      field('number', {}, { integer: true }),
      { type: decimal(0) },
      true,
    ],
    ['date to date', field('date'), { type: { base: 'date' } }, true],
    ['time to time', field('time'), { type: { base: 'time', fraction: 0 } }, true],
    ['a timed fraction to time', field('time'), { type: { base: 'time', fraction: 3 } }, false],
    [
      'instant to date and time',
      field('dateTime'),
      { type: { base: 'instant', fraction: 3 } },
      true,
    ],
    [
      'local date-time to date and time',
      field('dateTime'),
      { type: { base: 'localDateTime', fraction: 0 } },
      false,
    ],
    ['boolean to boolean', field('boolean'), { type: { base: 'boolean' } }, true],
    ['text to a user', field('user'), { type: { base: 'text' } }, false],
    ['text to a number', field('number'), { type: { base: 'text' } }, false],
    ['a list to a field of many', field('text', { multiplicity: 'many' }), { list: true }, true],
    ['a list to a field of one', field('text'), { list: true }, false],
    ['one value to a field of many', field('text', { multiplicity: 'many' }), {}, false],
  ];
  for (const [said, definition, over, takes] of pairs) {
    it(`${takes ? 'takes' : 'refuses'} ${said}`, () => {
      expect(seedable(definition, parameter(over))).toBe(takes);
    });
  }
});

describe("checking a template's parameters against its fields", () => {
  const feeding = (over: object = {}) =>
    parameter({ feeds: { field: SITE, arguments: false }, ...over });

  it('refuses a parameter feeding nothing, parameter_unused', () => {
    expect(checkTemplateParameters([parameter({ feeds: { arguments: false } })], [])).toEqual([
      {
        code: 'parameter_unused',
        parameter: 'site',
        message: 'The parameter site seeds no field and supplies no argument',
      },
    ]);
  });

  it('passes a field the document level holds and that takes the type', () => {
    expect(checkTemplateParameters([feeding()], [effective(field('text'))])).toEqual([]);
  });

  it('refuses a field the document level does not hold, as a section-level field, parameter_field', () => {
    expect(checkTemplateParameters([feeding()], [])).toMatchObject([
      { code: 'parameter_field', parameter: 'site', field: SITE },
    ]);
  });

  it('refuses a fixed field, and one that does not take the type, parameter_field', () => {
    expect(checkTemplateParameters([feeding()], [effective(field('text'), true)])).toMatchObject([
      { code: 'parameter_field', message: 'The parameter site seeds Site, which is fixed' },
    ]);
    expect(
      checkTemplateParameters([feeding({ type: { base: 'integer' } })], [effective(field('text'))]),
    ).toMatchObject([{ code: 'parameter_field', field: SITE }]);
  });

  it('refuses two parameters seeding one field, parameter_field naming both', () => {
    expect(
      checkTemplateParameters(
        [feeding(), feeding({ name: 'place', required: false })],
        [effective(field('text'))],
      ),
    ).toEqual([
      {
        code: 'parameter_field',
        parameter: 'site',
        field: SITE,
        message: 'The parameters site and place both seed Site',
      },
      {
        code: 'parameter_field',
        parameter: 'place',
        field: SITE,
        message: 'The parameters site and place both seed Site',
      },
    ]);
  });
});

describe("a document's parameter values", () => {
  it('refuse a name the template does not declare, before any value is checked', () => {
    expect(checkDocumentParameters([parameter()], { site: 3, other: 'x' })).toEqual({
      code: 'parameter_unknown',
      parameters: ['other'],
    });
  });

  it('refuse a missing required value and an invalid one, naming the parameter, rule and value', () => {
    const quarter = parameter({
      name: 'quarter',
      type: { base: 'integer' },
      permitted: { minimum: '1', maximum: '4' },
    });
    expect(checkDocumentParameters([parameter(), quarter], { quarter: '5' })).toEqual({
      code: 'parameter_invalid',
      problems: [
        { parameter: 'site', rule: 'required', value: '' },
        { parameter: 'quarter', rule: 'range', value: '5' },
      ],
    });
    expect(checkDocumentParameters([parameter(), quarter], { site: 'Leeds', quarter: '2' })).toBe(
      null,
    );
  });

  it('refuse a list holding one item twice, by the rule duplicate', () => {
    const sites = parameter({ name: 'sites', list: true });
    expect(checkDocumentParameters([sites], { sites: ['Leeds', 'York', 'Leeds'] })).toEqual({
      code: 'parameter_invalid',
      problems: [{ parameter: 'sites', rule: 'duplicate', value: 'Leeds' }],
    });
    expect(checkDocumentParameters([sites], { sites: ['Leeds', 'York'] })).toBe(null);
  });

  it('seed the fields they feed, and only those given', () => {
    const fed = parameter({ feeds: { field: SITE, arguments: true } });
    expect(
      seededValues([fed, parameter({ name: 'other' })], { site: 'Leeds', other: 'x' }),
    ).toEqual({ [SITE]: 'Leeds' });
    expect(seededValues([fed], {})).toEqual({});
  });

  it('are stored as names to canonical values, never null', () => {
    expect(documentParametersSchema.safeParse({ site: 'Leeds', on: true, at: ['1'] }).success).toBe(
      true,
    );
    expect(documentParametersSchema.safeParse({ site: null }).success).toBe(false);
    expect(documentParametersSchema.safeParse({ Site: 'x' }).success).toBe(false);
  });
});

describe("a document's parameter as a binding's argument (TP2-C)", () => {
  const asked = { name: 'from', type: { base: 'text' as const }, required: true, list: false };

  it('fits a parameter feeding arguments, of the same base type and list', () => {
    expect(argumentRefusal(parameter(), asked)).toBeNull();
    // Narrower bounds are the definition's to check against the value, not a refusal here.
    expect(
      argumentRefusal(parameter({ type: { base: 'decimal', precision: 10, scale: 2 } }), {
        ...asked,
        type: { base: 'decimal', precision: 6, scale: 2 },
      }),
    ).toBeNull();
  });

  it('refuses one not feeding arguments by feeds, and one of another type or list by type', () => {
    expect(argumentRefusal(parameter({ feeds: { field: SITE, arguments: false } }), asked)).toBe(
      'feeds',
    );
    expect(argumentRefusal(parameter({ type: { base: 'date' } }), asked)).toBe('type');
    expect(argumentRefusal(parameter({ list: true }), asked)).toBe('type');
  });
});
