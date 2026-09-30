import { describe, expect, it } from 'vitest';

import type { Parameter } from './definition.js';
import { bindPostgres, lexPostgres } from './sql.js';

const fetch = (text: string) => ({ kind: 'sql' as const, text });

describe("PostgreSQL's lexer, which finds a definition's markers", () => {
  it('finds a value marker and a variation marker, and reads everything else as text', () => {
    expect(lexPostgres('select * from t where a = {{site}} order by {{#sort}}')).toEqual([
      { kind: 'text', text: 'select * from t where a = ' },
      { kind: 'value', name: 'site' },
      { kind: 'text', text: ' order by ' },
      { kind: 'variation', name: 'sort' },
    ]);
    // A cast, an array slice and a marker written with spaces are text, not markers.
    for (const text of [
      'select a::int8 from t',
      'select a[1:2] from t',
      'select {{ x }} from t',
      'select {{X}} from t',
      'select $$a$$ || x$y$ from t',
    ]) {
      expect(lexPostgres(text), text).toEqual([{ kind: 'text', text }]);
    }
  });

  it('refuses a marker inside a string, an escape string, a dollar quote, a quoted identifier or a comment, naming its line', () => {
    const inside = [
      ["select 'it''s {{x}}'", 1],
      ["select E'\\' {{x}}'", 1],
      ["select e'\\\\' || '{{x}}'", 1],
      ["select U&'{{x}}'", 1],
      ['select $tag$ {{x}} $tag$', 1],
      ['select $$ {{x}} $$', 1],
      ['select "{{x}}" from t', 1],
      ['select 1\n-- {{x}}\nfrom t', 2],
      ['select 1 /* /* */ {{x}} */', 1],
      ['select 1 /*\n/* nested\n*/ {{x}} */', 3],
    ] as const;
    for (const [text, line] of inside) {
      const lexed = lexPostgres(text);
      expect(lexed, text).toMatchObject({ line });
      expect((lexed as { problem: string }).problem, text).toMatch(/marker/);
    }
    // And the same marker outside them is found, however the text before it quoted things.
    expect(
      lexPostgres("select 'it''s', E'\\'', $t$ ' $t$, \"a\"\"b\" -- x\n, {{x}}"),
    ).toContainEqual({
      kind: 'value',
      name: 'x',
    });
  });

  it('refuses a string, an identifier, a dollar quote or a comment left open, and a positional parameter', () => {
    for (const [text, line] of [
      ["select 'open", 1],
      ["select E'open\\'", 1],
      ['select "open', 1],
      ['select $a$ open $b$', 1],
      ['select 1\n/* open /* */', 2],
      ['select $1', 1],
      ['select a from t\nwhere b = $2', 2],
    ] as const) {
      expect(lexPostgres(text), text).toMatchObject({ line });
    }
  });
});

const integer = (name: string, over: Partial<Parameter> = {}): Parameter => ({
  name,
  type: { base: 'integer' },
  required: true,
  list: false,
  ...over,
});

describe("PostgreSQL's binder", () => {
  it("DAT-081 binds every value as the driver's parameter and never places one in the text", () => {
    const parameters: Parameter[] = [
      { name: 'label', type: { base: 'text' }, required: true, list: false },
      integer('min_id'),
      {
        name: 'amount',
        type: { base: 'decimal', precision: 12, scale: 2 },
        required: true,
        list: false,
      },
      { name: 'day', type: { base: 'date' }, required: true, list: false },
      { name: 'at', type: { base: 'time', fraction: 3 }, required: true, list: false },
      { name: 'local', type: { base: 'localDateTime', fraction: 6 }, required: true, list: false },
      { name: 'since', type: { base: 'instant', fraction: 6 }, required: true, list: false },
      { name: 'active', type: { base: 'boolean' }, required: true, list: false },
      integer('ids', { list: true }),
      { name: 'labels', type: { base: 'text' }, required: false, list: true },
      integer('unused_value', { required: false }),
    ];
    const hostile = "'; drop table t; --";
    const text = [
      'select id from t where label = {{label}} and id >= {{min_id}} and amount >= {{amount}}',
      'and day >= {{day}} and at >= {{at}} and local >= {{local}} and since >= {{since}}',
      'and active = {{active}} and id = any({{ids}}) and label = any({{labels}})',
      'and {{label}} is not null and {{unused_value}} is null',
    ].join('\n');
    const bound = bindPostgres(
      { parameters, fetch: fetch(text) },
      {
        label: hostile,
        min_id: '9223372036854775807',
        amount: '-0.5',
        day: '2026-09-30',
        at: '08:00:00.5',
        local: '2026-09-30T08:00:00',
        since: '2026-09-30T08:00:00Z',
        active: false,
        ids: ['1', '2'],
        labels: [hostile, 'b'],
      },
    );
    expect(bound.text).toBe(
      [
        'select id from t where label = $1::text and id >= $2::int8 and amount >= $3::numeric',
        'and day >= $4::date and at >= $5::time and local >= $6::timestamp and since >= $7::timestamptz',
        'and active = $8::boolean and id = any($9::int8[]) and label = any($10::text[])',
        'and $1::text is not null and $11::int8 is null',
      ].join('\n'),
    );
    expect(bound.values).toEqual([
      hostile,
      '9223372036854775807',
      '-0.5',
      '2026-09-30',
      '08:00:00.5',
      '2026-09-30T08:00:00',
      '2026-09-30T08:00:00Z',
      'false',
      ['1', '2'],
      [hostile, 'b'],
      null,
    ]);
    // Nothing of any value reached the text.
    expect(bound.text).not.toContain('drop');
    expect(bound.text).not.toContain('9223372036854775807');
  });

  it("DAT-019 places a variation's declared fragment by its key, and never the key itself", () => {
    const parameters: Parameter[] = [
      {
        name: 'sort',
        type: { base: 'text' },
        required: true,
        list: false,
        variation: [
          { key: 'amount', sql: 'amount desc, id' },
          { key: 'label', sql: 'label collate "C", id' },
        ],
      },
      integer('site'),
    ];
    const definition = {
      parameters,
      fetch: fetch('select id from t where site = {{site}} order by {{#sort}}'),
    };
    expect(bindPostgres(definition, { sort: 'label', site: '1' })).toEqual({
      text: 'select id from t where site = $1::int8 order by label collate "C", id',
      values: ['1'],
    });
    expect(bindPostgres(definition, { sort: 'amount', site: '1' }).text).toBe(
      'select id from t where site = $1::int8 order by amount desc, id',
    );
    // A key that is not declared - an inherited member's name among them - places nothing, and the
    // binder refuses rather than run the query without it.
    for (const key of ['__proto__', 'constructor', 'toString', 'id', 'amount desc; drop table t']) {
      expect(() => bindPostgres(definition, { sort: key, site: '1' }), key).toThrow(/variation/);
    }
  });
});
