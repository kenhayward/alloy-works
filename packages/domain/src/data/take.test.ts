import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../stored/canonical.js';
import type { Binding } from './binding.js';
import type { CanonicalResult, CanonicalValue } from './canonical.js';
import type { Column } from './definition.js';
import { TAKE_FAILURES, takeDigestInput, takeOutcomeSchema, takeValue } from './take.js';

/**
 * `takeValue` (the B1 plan, B1-E): the one rule by which the page, the editor and the publish take a
 * value from a stored result, against the columns its dataset version's provenance declares.
 */

type Take = Binding['take'];

const column = (name: string, type: Column['type'] = { base: 'text' }): Column => ({
  name,
  from: { column: name },
  type,
});

const COLUMNS: Column[] = [
  column('site'),
  column('depth', { base: 'decimal', precision: 6, scale: 1 }),
  column('note'),
  column('flag', { base: 'boolean' }),
];

const result = (...rows: CanonicalValue[][]): CanonicalResult => ({
  columns: [
    ['site', 'text'],
    ['depth', 'decimal'],
    ['note', 'text'],
    ['flag', 'boolean'],
  ],
  rows,
});

const DEPTH = { name: 'depth', type: { base: 'decimal', precision: 6, scale: 1 } } as const;

describe('takeValue', () => {
  it('DAT-031 fails a take of one column from more than one row by name, naming the count, and never takes the first', () => {
    const taken = takeValue(
      { column: 'depth' },
      result(['north', '12.5', 'a', true], ['south', '3', 'b', false], ['east', '7', 'c', true]),
      COLUMNS,
    );
    expect(taken).toEqual({ failure: 'value_many', count: 3 });
    // A key naming two rows is refused the same way: D2-M makes a key unique, and nothing trusts it.
    const keyed = takeValue(
      { key: { site: 'north' }, column: 'depth' },
      result(['north', '12.5', 'a', true], ['north', '3', 'b', false]),
      COLUMNS,
    );
    expect(keyed).toEqual({ failure: 'value_many', count: 2 });
  });

  it('DAT-032 fails a take that finds no row, a null or text of no characters by name, and never answers an empty string', () => {
    expect(takeValue({ column: 'depth' }, result(), COLUMNS)).toEqual({ failure: 'value_none' });
    expect(takeValue({ column: 'depth' }, result(['north', null, 'a', true]), COLUMNS)).toEqual({
      failure: 'value_null',
    });
    expect(takeValue({ column: 'note' }, result(['north', '1', '', true]), COLUMNS)).toEqual({
      failure: 'value_empty',
    });
    expect(takeValue({ column: 'note' }, result(['north', '1', '  \t ', true]), COLUMNS)).toEqual({
      failure: 'value_empty',
    });
    const rowsOf: CanonicalValue[][][] = [
      [],
      [['north', '1', '', true]],
      [['north', '1', null, true]],
    ];
    for (const rows of rowsOf) {
      const taken = takeValue({ column: 'note' }, result(...rows), COLUMNS);
      expect('value' in taken && taken.value === '').toBe(false);
    }
  });

  it('takes the cell of the only row, with the column it was declared as', () => {
    expect(takeValue({ column: 'depth' }, result(['north', '12.5', 'a', true]), COLUMNS)).toEqual({
      value: '12.5',
      column: DEPTH,
    });
    expect(takeValue({ column: 'flag' }, result(['north', '12.5', 'a', false]), COLUMNS)).toEqual({
      value: false,
      column: { name: 'flag', type: { base: 'boolean' } },
    });
  });

  it('takes the cell of the row a key names, matched on every key column, and fails one no row holds', () => {
    const rows = result(
      ['north', '12.5', 'a', true],
      ['north', '3', 'b', false],
      ['south', '7', 'c', true],
    );
    expect(
      takeValue({ key: { site: 'north', flag: false }, column: 'depth' }, rows, COLUMNS),
    ).toEqual({ value: '3', column: DEPTH });
    expect(takeValue({ key: { site: 'south' }, column: 'depth' }, rows, COLUMNS)).toEqual({
      value: '7',
      column: DEPTH,
    });
    expect(takeValue({ key: { site: 'west' }, column: 'depth' }, rows, COLUMNS)).toEqual({
      failure: 'row_missing',
    });
    // Compared as canonical strings: a boolean key never matches the text "true".
    expect(
      takeValue({ key: { site: 'south', flag: 'true' }, column: 'depth' }, rows, COLUMNS),
    ).toEqual({ failure: 'row_missing' });
  });

  it("fails a column, or a key column, that the provenance's declared columns do not have, before looking at a row, naming it", () => {
    expect(takeValue({ column: 'width' }, result(), COLUMNS)).toEqual({
      failure: 'take_invalid',
      column: 'width',
    });
    // A missing key column is named, not the column taken, which the version does declare.
    expect(
      takeValue(
        { key: { region: 'north' }, column: 'depth' },
        result(['north', '1', 'a', true]),
        COLUMNS,
      ),
    ).toEqual({ failure: 'take_invalid', column: 'region' });
    // The columns are the provenance's: a column the result holds but the version never declared is
    // not taken.
    expect(
      takeValue({ column: 'flag' }, result(['north', '1', 'a', true]), COLUMNS.slice(0, 3)),
    ).toEqual({ failure: 'take_invalid', column: 'flag' });
  });

  describe('an image (the B6 plan, B6-D)', () => {
    const HASH = 'ab'.repeat(32);
    const DESCRIBED = { base: 'image', encoding: 'binary', description: { column: 'caption' } };
    const DECORATIVE = { base: 'image', encoding: 'binary', description: 'decorative' };
    const photos = (type: object, ...rows: CanonicalValue[][]) => ({
      result: {
        columns: [
          ['site', 'text'],
          ['photo', 'image'],
          ['caption', 'text'],
        ],
        rows,
      } as CanonicalResult,
      columns: [column('site'), column('photo', type as Column['type']), column('caption')],
    });
    const take = (type: object, ...rows: CanonicalValue[][]) => {
      const { result: held, columns } = photos(type, ...rows);
      return takeValue({ key: { site: 'north' }, column: 'photo' }, held, columns);
    };

    it("DAT-097 takes an image's description from the column its definition names, read from the same row, or decorative where the definition says so", () => {
      expect(
        take(DESCRIBED, ['north', HASH, 'The north gate'], ['south', 'cd'.repeat(32), 'x']),
      ).toEqual({
        image: HASH,
        description: 'The north gate',
        column: { name: 'photo', type: DESCRIBED },
      });
      expect(take(DECORATIVE, ['north', HASH, null])).toEqual({
        image: HASH,
        description: 'decorative',
        column: { name: 'photo', type: DECORATIVE },
      });
      // A description that reads "decorative" is words, told apart by the column's type.
      expect(take(DESCRIBED, ['north', HASH, 'decorative'])).toMatchObject({
        description: 'decorative',
        column: { type: DESCRIBED },
      });
    });

    it('DAT-097 fails an image whose description is null or White_Space alone by name, naming the description column, image_description_missing', () => {
      for (const missing of [null, '', ' \t', String.fromCodePoint(0x85)]) {
        expect(take(DESCRIBED, ['north', HASH, missing]), JSON.stringify(missing)).toEqual({
          failure: 'image_description_missing',
          column: 'caption',
        });
      }
      // A null image is a null, before its description is read.
      expect(take(DESCRIBED, ['north', null, null])).toEqual({ failure: 'value_null' });
    });

    it('fails a description column the version does not declare or the result does not hold as take_invalid, naming it', () => {
      const { result: held } = photos(DESCRIBED, ['north', HASH, 'x']);
      const undeclared = [
        column('site'),
        column('photo', { ...DESCRIBED, description: { column: 'alt' } } as Column['type']),
        column('caption'),
      ];
      expect(takeValue({ column: 'photo' }, held, undeclared)).toEqual({
        failure: 'take_invalid',
        column: 'alt',
      });
    });
  });

  it("fails a column the version declares but the result's own columns do not hold, rather than read an absent cell", () => {
    const withoutFlag: CanonicalResult = {
      columns: [
        ['site', 'text'],
        ['depth', 'decimal'],
        ['note', 'text'],
      ],
      rows: [['north', '1', 'a']],
    };
    expect(takeValue({ column: 'flag' }, withoutFlag, COLUMNS)).toEqual({
      failure: 'take_invalid',
      column: 'flag',
    });
    expect(takeValue({ key: { flag: true }, column: 'depth' }, withoutFlag, COLUMNS)).toEqual({
      failure: 'take_invalid',
      column: 'flag',
    });
  });

  it('answers many rows before a null in the first of them, and a keyed take of no rows as no row the key names', () => {
    const firstNull = result(['north', null, 'a', true], ['south', '3', 'b', false]);
    expect(takeValue({ column: 'depth' }, firstNull, COLUMNS)).toEqual({
      failure: 'value_many',
      count: 2,
    });
    expect(takeValue({ key: { site: 'north' }, column: 'depth' }, result(), COLUMNS)).toEqual({
      failure: 'row_missing',
    });
  });

  it('reads a text of White_Space alone as empty, U+0085 among them, and one holding U+FEFF or U+200B as a value', () => {
    const NEL = String.fromCodePoint(0x85);
    const BOM = String.fromCodePoint(0xfeff);
    const ZWSP = String.fromCodePoint(0x200b);
    const IDEOGRAPHIC = String.fromCodePoint(0x3000);
    const take = (note: string) =>
      takeValue({ column: 'note' }, result(['north', '1', note, true]), COLUMNS);
    expect(take(NEL)).toEqual({ failure: 'value_empty' });
    expect(take(` ${IDEOGRAPHIC}\n`)).toEqual({ failure: 'value_empty' });
    expect(take(BOM)).toEqual({ value: BOM, column: { name: 'note', type: { base: 'text' } } });
    expect(take(ZWSP)).toEqual({ value: ZWSP, column: { name: 'note', type: { base: 'text' } } });
  });

  it('applies the order of the failures as written: no row before a null, a null before an empty text', () => {
    expect(TAKE_FAILURES).toEqual([
      'take_invalid',
      'value_none',
      'value_many',
      'row_missing',
      'value_null',
      'value_empty',
      'image_description_missing',
    ]);
  });
});

describe('takeOutcomeSchema', () => {
  const parses = (value: unknown) => takeOutcomeSchema.safeParse(value).success;

  it('holds a value with its declared column, or a failure with a count only where there are many', () => {
    expect(parses({ value: '12.5', column: DEPTH })).toBe(true);
    expect(parses({ value: true, column: { name: 'flag', type: { base: 'boolean' } } })).toBe(true);
    expect(parses({ failure: 'value_many', count: 2 })).toBe(true);
    expect(parses({ failure: 'take_invalid', column: 'region' })).toBe(true);
    expect(parses({ value: '42', column: { name: 'n', type: { base: 'integer' } } })).toBe(true);
    const ZWSP = String.fromCodePoint(0x200b);
    expect(parses({ value: ZWSP, column: { name: 'note', type: { base: 'text' } } })).toBe(true);
    expect(parses({ failure: 'image_description_missing', column: 'caption' })).toBe(true);
    for (const failure of TAKE_FAILURES.filter(
      (each) =>
        each !== 'value_many' && each !== 'take_invalid' && each !== 'image_description_missing',
    )) {
      expect(parses({ failure }), failure).toBe(true);
      expect(parses({ failure, count: 2 }), failure).toBe(false);
    }
  });

  it('holds an image with its column, decorative exactly where the column says so, and refuses any other image', () => {
    const HASH = 'ab'.repeat(32);
    const described = {
      name: 'photo',
      type: { base: 'image', encoding: 'binary', description: { column: 'caption' } },
    };
    const decorative = {
      name: 'photo',
      type: { base: 'image', encoding: 'base64', description: 'decorative' },
    };
    expect(parses({ image: HASH, description: 'The gate', column: described })).toBe(true);
    expect(parses({ image: HASH, description: 'decorative', column: decorative })).toBe(true);
    for (const loose of [
      { description: 'The gate', column: described },
      { image: 'AB'.repeat(32), description: 'The gate', column: described },
      { image: HASH, description: ' ', column: described },
      { image: HASH, description: '', column: described },
      { image: HASH, description: 'The gate', column: decorative },
      { image: HASH, column: decorative },
      { image: HASH, description: 'The gate', column: DEPTH },
      { image: HASH, description: 'The gate', column: described, value: 'x' },
      { failure: 'image_description_missing' },
    ]) {
      expect(parses(loose), JSON.stringify(loose)).toBe(false);
    }
  });

  it('refuses every other shape', () => {
    for (const loose of [
      { failure: 'value_many' },
      { failure: 'value_many', count: 1 },
      { failure: 'value_many', count: 2.5 },
      { failure: 'result_unreadable' },
      { value: null, column: DEPTH },
      { value: 12.5, column: DEPTH },
      { value: '1', column: { ...DEPTH, from: { column: 'depth' } } },
      { value: '1', column: { name: 'x', type: { base: 'image' } } },
      { value: '1' },
      { value: '1', column: DEPTH, failure: 'value_none' },
      { failure: 'value_none', reason: 'x' },
      // take_invalid names the column it lacks, and nothing else does.
      { failure: 'take_invalid' },
      { failure: 'take_invalid', column: '' },
      { failure: 'take_invalid', column: 7 },
      { failure: 'value_none', column: 'depth' },
      { failure: 'value_many', count: 2, column: 'depth' },
    ]) {
      expect(parses(loose), JSON.stringify(loose)).toBe(false);
    }
  });

  it('refuses a value takeValue never answers: one not canonical in its declared type, or a text of spaces alone', () => {
    const NOTE = { name: 'note', type: { base: 'text' } } as const;
    for (const loose of [
      { value: '', column: NOTE },
      { value: ' \t', column: NOTE },
      { value: String.fromCodePoint(0x85), column: NOTE },
      { value: true, column: DEPTH },
      { value: '12.50', column: DEPTH },
      { value: 'abc', column: { name: 'n', type: { base: 'integer' } } },
      { value: 'true', column: { name: 'flag', type: { base: 'boolean' } } },
    ]) {
      expect(parses(loose), JSON.stringify(loose)).toBe(false);
    }
  });
});

describe('takeDigestInput', () => {
  it("is the take's canonical form, its members sorted and no set rule, so a key named marks keeps its value", () => {
    const take: Take = { key: { site: 'north', marks: 'b' }, column: 'depth' };
    expect(takeDigestInput(take)).toBe('{"column":"depth","key":{"marks":"b","site":"north"}}');
    expect(takeDigestInput(take)).toBe(canonicalJson(take));
    expect(takeDigestInput({ column: 'depth' })).toBe('{"column":"depth"}');
  });
});
