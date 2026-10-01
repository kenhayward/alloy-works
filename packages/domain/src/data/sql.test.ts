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

/** A backslash, built rather than typed, so no tool on the way reads it as an escape. */
const BACKSLASH = String.fromCharCode(92);

describe("the lexer, where PostgreSQL's own scanner reads otherwise", () => {
  it('reads a string continued across a newline as one literal of its first kind, escapes and all', () => {
    // An escape string, continued: its second part keeps the escapes, so a backslash and a quote do
    // not close it, and the marker is inside the literal, as PostgreSQL reads it.
    const continued = `select 1::int8 as id, E'a'
'${BACKSLASH}' || {{x}} || ' as c -- '`;
    expect(lexPostgres(continued)).toMatchObject({
      line: 2,
      problem: expect.stringMatching(/marker/),
    });
    // And one that PostgreSQL reads whole - an escaped quote in the continued part - is one text.
    const whole = `select 1::int8 as id, E'a'
'${BACKSLASH}'' as c`;
    expect(lexPostgres(whole)).toEqual([{ kind: 'text', text: whole }]);
    // A standard string continues too, past a comment before the newline; a marker after it is found.
    expect(lexPostgres("select 'a' -- {{x}}\n  'b' as c")).toMatchObject({ line: 1 });
    expect(lexPostgres("select 'a'\n'b' || {{x}}")).toContainEqual({ kind: 'value', name: 'x' });
    // An empty comment between them is not the white space that continues a string, as PostgreSQL 18
    // has it too (a syntax error there): the binder sets a fragment apart so.
    expect(
      lexPostgres(`select E'a' /**/
'${BACKSLASH}' as b, {{x}} as c --'`),
    ).toContainEqual({ kind: 'value', name: 'x' });
    // Without a newline between them, two strings are two, and a marker between them is outside.
    expect(lexPostgres("select 'a' || {{x}} || 'b'")).toContainEqual({ kind: 'value', name: 'x' });
  });

  it('reads a dollar quote whatever the length of its tag', () => {
    const tag = `$${'a'.repeat(200)}$`;
    expect(lexPostgres(`select ${tag} {{x}} ${tag}`)).toMatchObject({
      problem: expect.stringMatching(/marker/),
    });
    const quoted = `select 1::int8 as id, ${tag} it's ${tag} as c`;
    expect(lexPostgres(quoted)).toEqual([{ kind: 'text', text: quoted }]);
  });

  it('reads a $ that opens nothing as a token of its own, so a letter after it can still begin a string', () => {
    // PostgreSQL 18 reads `$E'...'` as a lone `$` and an escape string, which here runs to the last
    // quote with the marker inside it; read as one name `$E` and a standard string, it was outside.
    const escaped = `select 1::int8 as id $E'${BACKSLASH}' where {{x}} is not null --'`;
    expect(lexPostgres(escaped)).toMatchObject({
      line: 1,
      problem: expect.stringMatching(/marker/),
    });
    // A name that holds a $ after its first letter is still one name, and a $ before a name is text.
    for (const text of ['select x$E from t', 'select $abc from t']) {
      expect(lexPostgres(text), text).toEqual([{ kind: 'text', text }]);
    }
  });

  it('refuses a number followed directly by a letter, a quote or a $, which PostgreSQL versions read apart', () => {
    // PostgreSQL 14 reads `1e5E'...'` as a number and an escape string, and `1a$b$` as 1 and the name
    // a$b$; 15 and later refuse both as trailing junk. Refused when written, naming the line.
    const backslash = String.fromCharCode(92);
    for (const [text, line] of [
      ['select 1$1', 1],
      ['select 1.5$2 from t', 1],
      ['select x.1$1', 1],
      [`select 1\n, 1e5E'${backslash}' {{x}} '`, 2],
      ['select 1a$b$ {{x}} $b$', 1],
      ["select 1'a'", 1],
      ['select 12abc', 1],
      ['select 0x1F', 1],
    ] as const) {
      expect(lexPostgres(text), text).toMatchObject({
        line,
        problem: expect.stringMatching(/number/),
      });
    }
    // The words say how to write the number, for one PostgreSQL 16 would take as it is.
    for (const text of [
      'select 0x1F',
      'select 1_000',
      'select 10_000.000_1',
      'select 0o17',
      'select 0b101',
    ]) {
      const lexed = lexPostgres(text) as { problem: string };
      expect(lexed.problem, text).toMatch(/plain decimal digits/);
      expect(lexed.problem, text).toMatch(/0x, 0o, 0b or underscores/);
    }
    // A number written whole, its exponent among it, is a number; a name holds a $ and digits.
    for (const text of [
      'select 1, 1.5, .5, 1e5, 1.5E+3, 2e-1 from t',
      'select x$1, _y$2$z from t',
    ]) {
      expect(lexPostgres(text), text).toEqual([{ kind: 'text', text }]);
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
        'select id from t where label =  ($1::text)  and id >=  ($2::int8)  and amount >=  ($3::numeric) ',
        'and day >=  ($4::date)  and at >=  ($5::time)  and local >=  ($6::timestamp)  and since >=  ($7::timestamptz) ',
        'and active =  ($8::boolean)  and id = any( ($9::int8[]) ) and label = any( ($10::text[]) )',
        'and  ($1::text)  is not null and  ($11::int8)  is null',
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

  it('writes each placeholder parenthesised with a space either side, so it never fuses with what the author wrote beside it', () => {
    const text = (sql: string) =>
      bindPostgres(
        {
          parameters: [
            { name: 'x', type: { base: 'text' }, required: true, list: false },
            { name: 'y', type: { base: 'text' }, required: true, list: false },
            integer('ids', { list: true, required: false }),
          ],
          fetch: fetch(sql),
        },
        { x: 'a', y: 'b' },
      ).text;
    // A name before it, a dollar sign, and a placeholder beside another.
    expect(text('select a{{x}}, {{y}} as b, {{ids}}')).toBe(
      'select a ($1::text) ,  ($2::text)  as b,  ($3::int8[]) ',
    );
    expect(text('select ${{x}}, {{y}}, {{ids}}')).toBe(
      'select $ ($1::text) ,  ($2::text) ,  ($3::int8[]) ',
    );
    expect(text('select {{x}}{{y}}, {{ids}}')).toBe(
      'select  ($1::text)  ($2::text) ,  ($3::int8[]) ',
    );
    // A subscript after it is the value's, never the cast's: `$3::int8[][2]` is a type.
    expect(text('select {{x}}, {{y}}, {{ids}}[2]')).toBe(
      'select  ($1::text) ,  ($2::text) ,  ($3::int8[]) [2]',
    );
  });

  it('refuses a binding whose text, read again, does not hold exactly the placeholders it wrote', () => {
    // A fragment the definition's checks refuse - a line comment running past its end - placed all the
    // same makes a comment of the placeholder after it: nothing runs.
    const definition = {
      parameters: [
        integer('x'),
        {
          name: 'v',
          type: { base: 'text' as const },
          required: true,
          list: false,
          variation: [{ key: 'note', sql: '-- note' }],
        },
      ],
      fetch: fetch('select 1 {{#v}} + {{x}} as id'),
    };
    expect(lexPostgres(definition.fetch.text)).not.toHaveProperty('problem');
    expect(() => bindPostgres(definition, { x: '1', v: 'note' })).toThrow(/placeholder/);
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
      text: 'select id from t where site =  ($1::int8)  order by  /**/ label collate "C", id /**/ ',
      values: ['1'],
    });
    expect(bindPostgres(definition, { sort: 'amount', site: '1' }).text).toBe(
      'select id from t where site =  ($1::int8)  order by  /**/ amount desc, id /**/ ',
    );
    // A key that is not declared - an inherited member's name among them - places nothing, and the
    // binder refuses rather than run the query without it.
    for (const key of ['__proto__', 'constructor', 'toString', 'id', 'amount desc; drop table t']) {
      expect(() => bindPostgres(definition, { sort: key, site: '1' }), key).toThrow(/variation/);
    }
  });
});
