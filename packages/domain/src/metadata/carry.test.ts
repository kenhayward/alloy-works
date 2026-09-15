import { describe, expect, it } from 'vitest';

import { carryForward } from './carry.js';
import { componentTypeDefinitionSchema } from './component-type.js';
import { DEFINITION_SCHEMA_VERSION } from './definition.js';
import { fieldDefinitionSchema, type FieldDefinition } from './field.js';
import { resolveComponentFields, type EffectiveField } from './resolve.js';
import { metadataSchemaDefinitionSchema } from './schema.js';
import { validate } from './validate.js';

const identity = (id: string) => ({ schemaVersion: DEFINITION_SCHEMA_VERSION, id, name: id });

const textField = (id: string, multiplicity: 'one' | 'many' = 'one'): FieldDefinition =>
  fieldDefinitionSchema.parse({ ...identity(id), dataType: 'text', multiplicity, validation: {} });

const effectiveOf = (
  field: FieldDefinition,
  options: { default?: unknown; fixedBy?: string[] } = {},
): EffectiveField => ({
  field,
  required: false,
  requiredBy: [],
  fixed: (options.fixedBy ?? []).length > 0,
  fixedBy: options.fixedBy ?? [],
  ...(options.default === undefined
    ? {}
    : { default: { value: options.default, from: options.fixedBy ?? ['schema-reg'] } }),
});

describe('carryForward', () => {
  it('MET-036 carries a value whose field still applies, unchanged, even when it is now invalid', () => {
    const study = effectiveOf(textField('field-study'));
    const invalid = { user: 'not text at all' };
    const { values, notCarried } = carryForward({ 'field-study': invalid }, [study]);
    expect(values['field-study']).toBe(invalid);
    expect(notCarried).toEqual([]);
  });

  it('MET-036 records every value whose field no longer applies, by field, and carries none of them', () => {
    const study = effectiveOf(textField('field-study'));
    const { values, notCarried } = carryForward(
      { 'field-study': 'S-1', 'field-site': 'Leeds', 'field-arm': ['A', 'B'] },
      [study],
    );
    expect(values).toEqual({ 'field-study': 'S-1' });
    expect(notCarried).toEqual([
      { field: 'field-arm', value: ['A', 'B'] },
      { field: 'field-site', value: 'Leeds' },
    ]);
  });

  it('MET-036 drops a clear whose field no longer applies, since it holds nothing to record', () => {
    expect(carryForward({ 'field-site': null, 'field-arm': [] }, [])).toEqual({
      values: {},
      notCarried: [],
    });
  });

  it('MET-006 fills a field with no member from its default, which is how a fixed field is filled', () => {
    const controlled = effectiveOf(textField('field-controlled'), {
      default: 'yes',
      fixedBy: ['schema-reg'],
    });
    const markets = effectiveOf(textField('field-markets', 'many'), { default: ['uk', 'us'] });
    const plain = effectiveOf(textField('field-note'));
    expect(carryForward({}, [controlled, markets, plain]).values).toEqual({
      'field-controlled': 'yes',
      'field-markets': ['uk', 'us'],
    });
  });

  it('takes the default for a member explicitly set to undefined, the same as no member at all', () => {
    const study = effectiveOf(textField('field-study'), { default: 'S-0' });
    const { values } = carryForward({ 'field-study': undefined }, [study]);
    expect(values).toEqual({ 'field-study': 'S-0' });
  });

  it('copies a default, so changing the values carried cannot change a definition', () => {
    const markets = effectiveOf(textField('field-markets', 'many'), { default: ['uk'] });
    const { values } = carryForward({}, [markets]);
    (values['field-markets'] as string[]).push('us');
    expect(markets.default?.value).toEqual(['uk']);
  });

  it('MET-036 keeps a clear: null on a one field and an empty list on a many field, each with a default', () => {
    const study = effectiveOf(textField('field-study'), { default: 'S-0' });
    const markets = effectiveOf(textField('field-markets', 'many'), { default: ['uk'] });
    expect(carryForward({ 'field-study': null, 'field-markets': [] }, [study, markets])).toEqual({
      values: { 'field-study': null, 'field-markets': [] },
      notCarried: [],
    });
  });

  it('MET-036 never replaces a present value on a fixed field, and validate names every schema fixing it', () => {
    const controlled = textField('field-controlled');
    const effective = resolveComponentFields(
      componentTypeDefinitionSchema.parse({
        ...identity('type-protocol'),
        assignments: [
          { schema: 'schema-reg', requires: [] },
          { schema: 'schema-quality', requires: [] },
        ],
      }),
      ['schema-reg', 'schema-quality'].map((id) =>
        metadataSchemaDefinitionSchema.parse({
          ...identity(id),
          entries: [{ field: 'field-controlled', required: false, default: 'yes', fixed: true }],
        }),
      ),
      [controlled],
    );
    const { values } = carryForward({ 'field-controlled': 'no' }, effective);
    expect(values).toEqual({ 'field-controlled': 'no' });
    expect(validate(effective, values)).toEqual([
      expect.objectContaining({
        code: 'metadata.fixed',
        schemas: ['schema-reg', 'schema-quality'],
      }),
    ]);
  });

  it('treats a field whose identifier is __proto__ as a field like any other', () => {
    const odd = effectiveOf(textField('__proto__'), { default: 'x' });
    const { values } = carryForward({}, [odd]);
    expect(Object.keys(values)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
  });
});

/**
 * A hand-written generator rather than a property-testing library. Nothing in the workspace depends on
 * one, the property is a partition that needs no shrinking to diagnose - a failing case prints its seed
 * and its input whole - and a seeded generator runs the same cases on Windows and on Linux.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('carryForward, as a property', () => {
  const pick = <T>(random: () => number, from: readonly T[]): T =>
    from[Math.floor(random() * from.length)] as T;

  const candidates: readonly unknown[] = [
    null,
    [],
    'Ada',
    'café',
    '0.1',
    true,
    false,
    { user: 'user-grace' },
    ['uk', 'us'],
    [{ user: 'user-ada' }],
    42,
    { unexpected: 'shape' },
  ];
  const ids = ['field-a', 'field-b', 'field-c', 'field-d', 'field-e', 'field-f'];

  it('MET-036 carries or records every value but a clear exactly once, and carries each byte-identical', () => {
    const seed = 20260915;
    const random = seeded(seed);
    for (let run = 0; run < 1000; run += 1) {
      const values: Record<string, unknown> = {};
      for (const id of ids) if (random() < 0.6) values[id] = pick(random, candidates);
      const effective = ids
        .filter(() => random() < 0.5)
        .map((id) =>
          effectiveOf(
            textField(id),
            random() < 0.4 ? { default: pick(random, ['S-0', true]) } : {},
          ),
        );
      const effectiveIds = new Set(effective.map((each) => each.field.id));
      const label = `seed ${seed}, run ${run}: ${JSON.stringify({ values, effective: [...effectiveIds] })}`;

      const before = JSON.stringify(values);
      const result = carryForward(values, effective);
      expect(JSON.stringify(values), `${label} input unchanged`).toBe(before);

      for (const [id, value] of Object.entries(values)) {
        const carried = Object.hasOwn(result.values, id);
        const recorded = result.notCarried.filter((each) => each.field === id);
        const clear = value === null || (Array.isArray(value) && value.length === 0);
        if (effectiveIds.has(id)) {
          // Present on an effective field, clear or not: carried, and the very same value.
          expect(carried, label).toBe(true);
          expect(result.values[id], label).toBe(value);
          expect(JSON.stringify(result.values[id]), label).toBe(JSON.stringify(value));
          expect(recorded, label).toEqual([]);
        } else if (clear) {
          expect(carried || recorded.length > 0, `${label} a clear for ${id} is dropped`).toBe(
            false,
          );
        } else {
          expect(carried, label).toBe(false);
          expect(recorded, label).toHaveLength(1);
          expect(recorded[0]?.value, label).toBe(value);
        }
      }

      for (const id of Object.keys(result.values)) {
        if (Object.hasOwn(values, id)) continue;
        // Nothing appears that was not there, except a default for a field with no member.
        const field = effective.find((each) => each.field.id === id);
        expect(field?.default, `${label} ${id} appeared from nowhere`).toBeDefined();
        expect(result.values[id], label).toEqual(field?.default?.value);
      }
    }
  });
});
