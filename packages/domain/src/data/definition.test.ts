import { describe, expect, it } from 'vitest';

import {
  DefinitionRefused,
  checkQueryDefinition,
  draftDefinitionSchema,
  parseDraftDefinition,
  parseQueryDefinition,
  parseQueryDefinitionForWrite,
  type Parameter,
  type QueryDefinition,
} from './definition.js';
import { defaultLimits, limitCeilings } from './limits.js';
import { checkParameterValues } from './parameters.js';
import { canonicalJson } from '../stored/canonical.js';
import { bindPostgres } from './sql.js';

const CONNECTION = '00000000-0000-4000-8000-00000000c0c0';

function definition(over: Partial<QueryDefinition> = {}): QueryDefinition {
  return {
    schemaVersion: 1,
    title: 'Readings by site',
    description: 'Each reading at a site, oldest first.',
    connection: CONNECTION,
    parameters: [
      { name: 'site', type: { base: 'integer' }, required: true, list: false },
      {
        name: 'sort',
        type: { base: 'text' },
        required: true,
        list: false,
        variation: [
          { key: 'taken', sql: 'taken, id' },
          { key: 'value', sql: 'value desc, id' },
        ],
      },
    ],
    fetch: {
      kind: 'sql',
      text: 'select id, taken, value from sample.reading where site = {{site}} order by {{#sort}}',
    },
    columns: [
      { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
      { name: 'taken', from: { column: 'taken' }, type: { base: 'instant', fraction: 3 } },
      {
        name: 'value',
        from: { column: 'value' },
        type: { base: 'decimal', precision: 12, scale: 4 },
      },
    ],
    key: ['id'],
    order: [{ column: 'id', direction: 'ascending' }],
    empty: 'valid',
    limits: { ...defaultLimits },
    retired: false,
    ...over,
  };
}

/** The paths a definition is refused at, by the shape or by the checks, or [] where it is taken. */
function refusedAt(value: unknown): string[] {
  try {
    parseQueryDefinitionForWrite(value);
    return [];
  } catch (error) {
    if (!(error instanceof DefinitionRefused)) throw error;
    for (const problem of error.problems) expect(problem.rule).toBe('definition_invalid');
    return error.problems.map((problem) => problem.path);
  }
}

const withParameters = (parameters: Parameter[], text: string) =>
  definition({ parameters, fetch: { kind: 'sql', text } });

describe('a query definition', () => {
  it('takes a whole definition, and reads it back by its shape alone', () => {
    const made = definition();
    expect(parseQueryDefinitionForWrite(made)).toEqual(made);
    expect(parseQueryDefinition(made)).toEqual(made);
    expect(checkQueryDefinition(made)).toEqual([]);
  });

  it("DAT-010 declares each parameter's name, type, whether required, and its permitted values or range, or refuses the declaration by rule", () => {
    const text = (names: string[]) =>
      `select 1 where ${names.map((name) => `{{${name}}}`).join(' and ')}`;
    const one = (parameter: Parameter) => withParameters([parameter], text([parameter.name]));
    const taken: Parameter[] = [
      { name: 'label', type: { base: 'text' }, required: false, list: true },
      {
        name: 'site',
        type: { base: 'integer' },
        required: true,
        list: false,
        permitted: { values: ['1', '2'] },
      },
      {
        name: 'depth',
        type: { base: 'decimal', precision: 8, scale: 2 },
        required: true,
        list: false,
        permitted: { minimum: '-1.5', maximum: '100' },
      },
      {
        name: 'since',
        type: { base: 'instant', fraction: 3 },
        required: true,
        list: false,
        permitted: { minimum: '2026-01-01T00:00:00Z' },
      },
      {
        name: 'day',
        type: { base: 'date' },
        required: true,
        list: false,
        permitted: { maximum: '2026-12-31' },
      },
      {
        name: 'active',
        type: { base: 'boolean' },
        required: true,
        list: false,
        permitted: { values: [true] },
      },
    ];
    for (const parameter of taken) expect(refusedAt(one(parameter)), parameter.name).toEqual([]);

    const refused: readonly [Parameter, string][] = [
      [
        { name: 'Site', type: { base: 'integer' }, required: true, list: false },
        'parameters.0.name',
      ],
      [
        { name: '_site', type: { base: 'integer' }, required: true, list: false },
        'parameters.0.name',
      ],
      [
        { name: `s${'x'.repeat(63)}`, type: { base: 'integer' }, required: true, list: false },
        'parameters.0.name',
      ],
      [
        {
          name: 'site',
          type: { base: 'image', encoding: 'base64', description: 'decorative' } as never,
          required: true,
          list: false,
        },
        'parameters.0.type.base',
      ],
      [
        { name: 'site', type: { base: 'float' } as never, required: true, list: false },
        'parameters.0.type.base',
      ],
      [{ name: 'site', type: { base: 'integer' }, list: false } as never, 'parameters.0.required'],
      [
        {
          name: 'site',
          type: { base: 'integer' },
          required: true,
          list: false,
          permitted: { values: [] },
        },
        'parameters.0.permitted.values',
      ],
      [
        {
          name: 'site',
          type: { base: 'integer' },
          required: true,
          list: false,
          permitted: { values: ['1', '1'] },
        },
        'parameters.0.permitted.values',
      ],
      [
        {
          name: 'site',
          type: { base: 'integer' },
          required: true,
          list: false,
          permitted: { values: ['01'] },
        },
        'parameters.0.permitted.values.0',
      ],
      [
        {
          name: 'site',
          type: { base: 'integer' },
          required: true,
          list: false,
          permitted: { values: [null] },
        },
        'parameters.0.permitted.values.0',
      ],
      [
        {
          name: 'site',
          type: { base: 'integer' },
          required: true,
          list: false,
          permitted: { values: Array.from({ length: 201 }, (_, i) => String(i)) },
        },
        'parameters.0.permitted.values',
      ],
      [
        { name: 'site', type: { base: 'integer' }, required: true, list: false, permitted: {} },
        'parameters.0.permitted',
      ],
      [
        {
          name: 'site',
          type: { base: 'integer' },
          required: true,
          list: false,
          permitted: { minimum: '10', maximum: '1' },
        },
        'parameters.0.permitted',
      ],
      [
        {
          name: 'site',
          type: { base: 'integer' },
          required: true,
          list: false,
          permitted: { minimum: '1.5' },
        },
        'parameters.0.permitted.minimum',
      ],
      [
        {
          name: 'label',
          type: { base: 'text' },
          required: true,
          list: false,
          permitted: { minimum: 'a' },
        },
        'parameters.0.permitted',
      ],
      [
        {
          name: 'active',
          type: { base: 'boolean' },
          required: true,
          list: false,
          permitted: { maximum: true } as never,
        },
        'parameters.0.permitted',
      ],
    ];
    for (const [parameter, path] of refused) {
      expect(refusedAt(one(parameter)), `${parameter.name} at ${path}`).toContain(path);
    }
    // A name declared twice, a parameter no marker uses, and a marker naming nothing.
    const site: Parameter = {
      name: 'site',
      type: { base: 'integer' },
      required: true,
      list: false,
    };
    expect(refusedAt(withParameters([site, site], text(['site'])))).toContain('parameters.1.name');
    expect(refusedAt(withParameters([site], 'select 1'))).toContain('parameters.0');
    expect(refusedAt(withParameters([], text(['site'])))).toContain('fetch.text');
    expect(
      refusedAt(
        withParameters(
          Array.from({ length: 51 }, (_, i) => ({ ...site, name: `p${i}` })),
          text(Array.from({ length: 51 }, (_, i) => `p${i}`)),
        ),
      ),
    ).toContain('parameters');
  });

  it('declares a variation on a required text parameter alone, used by its own marker, each fragment lexing whole and holding no marker', () => {
    const sort = (over: Partial<Parameter> = {}): Parameter => ({
      name: 'sort',
      type: { base: 'text' },
      required: true,
      list: false,
      variation: [{ key: 'taken', sql: 'taken, id' }],
      ...over,
    });
    const text = 'select id from t order by {{#sort}}';
    expect(refusedAt(withParameters([sort()], text))).toEqual([]);
    const refused: readonly [Parameter, string, string][] = [
      [sort({ required: false }), text, 'parameters.0.variation'],
      [sort({ list: true }), text, 'parameters.0.variation'],
      [sort({ type: { base: 'integer' } }), text, 'parameters.0.variation'],
      [sort({ permitted: { values: ['taken'] } }), text, 'parameters.0.variation'],
      [sort({ variation: [] }), text, 'parameters.0.variation'],
      [
        sort({
          variation: [
            { key: 'taken', sql: 'a' },
            { key: 'taken', sql: 'b' },
          ],
        }),
        text,
        'parameters.0.variation.1.key',
      ],
      [sort({ variation: [{ key: '__proto__', sql: 'a' }] }), text, 'parameters.0.variation.0.key'],
      [sort({ variation: [{ key: 'taken', sql: '' }] }), text, 'parameters.0.variation.0.sql'],
      [
        sort({ variation: [{ key: 'taken', sql: "taken, 'open" }] }),
        text,
        'parameters.0.variation.0.sql',
      ],
      [
        sort({ variation: [{ key: 'taken', sql: 'taken, {{site}}' }] }),
        text,
        'parameters.0.variation.0.sql',
      ],
      [
        sort({ variation: [{ key: 'taken', sql: 'x'.repeat(2001) }] }),
        text,
        'parameters.0.variation.0.sql',
      ],
      // A variation used as a value, and a value parameter used as a variation.
      [sort(), 'select id from t where a = {{sort}}', 'fetch.text'],
      [sort({ variation: undefined }), text, 'fetch.text'],
    ];
    for (const [parameter, sql, path] of refused) {
      expect(refusedAt(withParameters([parameter], sql)), path).toContain(path);
    }
  });

  it('holds its fetch to SQL text that lexes whole, with every marker outside a quote or a comment', () => {
    const site: Parameter = {
      name: 'site',
      type: { base: 'integer' },
      required: true,
      list: false,
    };
    for (const text of [
      '',
      'x'.repeat(100_001),
      "select 1 where a = '{{site}}'",
      "select 'open {{site}}",
      'select $1, {{site}}',
    ]) {
      expect(refusedAt(withParameters([site], text)), text.slice(0, 30)).toContain('fetch.text');
    }
    expect(refusedAt(definition({ fetch: { kind: 'builder', query: {} } as never }))).toContain(
      'fetch.kind',
    );
  });

  it('has a title, a description and exactly one connection', () => {
    expect(refusedAt(definition({ title: '' }))).toContain('title');
    expect(refusedAt(definition({ title: ' Readings' }))).toContain('title');
    expect(refusedAt(definition({ title: 'x'.repeat(201) }))).toContain('title');
    expect(refusedAt(definition({ title: `a${String.fromCharCode(9)}b` }))).toContain('title');
    expect(refusedAt(definition({ description: 'x'.repeat(2001) }))).toContain('description');
    expect(refusedAt(definition({ description: `one\ntwo` }))).toEqual([]);
    expect(refusedAt(definition({ description: `one\rtwo` }))).toContain('description');
    expect(refusedAt(definition({ connection: [CONNECTION] as never }))).toContain('connection');
    expect(refusedAt(definition({ connection: 'not-a-uuid' }))).toContain('connection');
    expect(refusedAt({ ...definition(), connections: [CONNECTION] })).toContain('');
  });

  it('declares its columns from the closed list of types, each once', () => {
    const [id, taken, value] = definition().columns as [
      QueryDefinition['columns'][number],
      QueryDefinition['columns'][number],
      QueryDefinition['columns'][number],
    ];
    expect(refusedAt(definition({ columns: [] }))).toContain('columns');
    expect(
      refusedAt(
        definition({ columns: [id, taken, { ...value, type: { base: 'float' } as never }] }),
      ),
    ).toContain('columns.2.type.base');
    expect(
      refusedAt(
        definition({
          columns: [
            id,
            taken,
            {
              ...value,
              type: { base: 'image', encoding: 'binary', description: 'decorative' } as never,
            },
          ],
        }),
      ),
    ).toContain('columns.2.type.base');
    expect(refusedAt(definition({ columns: [id, taken, { ...value, name: 'id' }] }))).toContain(
      'columns.2.name',
    );
    expect(
      refusedAt(definition({ columns: [id, taken, { ...value, name: 'x'.repeat(64) }] })),
    ).toContain('columns.2.name');
    expect(
      refusedAt(definition({ columns: [id, taken, { ...value, from: { column: '' } }] })),
    ).toContain('columns.2.from.column');
    expect(
      refusedAt(
        definition({ columns: [id, taken, { ...value, from: { pointer: '/a' } } as never] }),
      ),
    ).toContain('columns.2.from');
  });

  it('states a total order over a key, or is a multiset', () => {
    expect(refusedAt(definition({ order: 'multiset', key: [] }))).toEqual([]);
    expect(refusedAt(definition({ order: 'multiset', key: ['id'] }))).toEqual([]);
    expect(
      refusedAt(
        definition({
          key: ['id'],
          order: [
            { column: 'taken', direction: 'descending' },
            { column: 'id', direction: 'ascending' },
          ],
        }),
      ),
    ).toEqual([]);
    expect(
      refusedAt(definition({ key: [], order: [{ column: 'id', direction: 'ascending' }] })),
    ).toContain('order');
    expect(
      refusedAt(definition({ key: ['id'], order: [{ column: 'taken', direction: 'ascending' }] })),
    ).toContain('order');
    expect(refusedAt(definition({ order: [] }))).toContain('order');
    expect(
      refusedAt(
        definition({
          order: [
            { column: 'id', direction: 'ascending' },
            { column: 'id', direction: 'descending' },
          ],
        }),
      ),
    ).toContain('order.1.column');
    expect(
      refusedAt(definition({ order: [{ column: 'nothing', direction: 'ascending' }] })),
    ).toContain('order.0.column');
    expect(refusedAt(definition({ key: ['nothing'] }))).toContain('key.0');
    expect(refusedAt(definition({ key: ['id', 'id'] }))).toContain('key.1');
    expect(refusedAt(definition({ order: 'unordered' as never }))).toContain('order');
  });

  it('says whether an empty result is valid, and holds limits within the ceilings', () => {
    expect(refusedAt(definition({ empty: 'invalid' }))).toEqual([]);
    expect(refusedAt(definition({ empty: true as never }))).toContain('empty');
    expect(refusedAt(definition({ limits: { ...limitCeilings } }))).toEqual([]);
    expect(refusedAt(definition({ limits: { rows: 1, bytes: 1, seconds: 1 } }))).toEqual([]);
    for (const limit of ['rows', 'bytes', 'seconds'] as const) {
      for (const bad of [0, limitCeilings[limit] + 1, 1.5, -1]) {
        expect(
          refusedAt(definition({ limits: { ...defaultLimits, [limit]: bad } })),
          `${limit} ${bad}`,
        ).toContain(`limits.${limit}`);
      }
    }
  });

  it('refuses a string that is not already NFC, naming the member, since a digest would not tell it apart (D2-F)', () => {
    const decomposed = `cafe${String.fromCodePoint(0x301)}`;
    expect(refusedAt(definition({ title: decomposed }))).toEqual(['title']);
    expect(refusedAt(definition({ description: decomposed }))).toEqual(['description']);
    const base = definition();
    expect(
      refusedAt({ ...base, fetch: { kind: 'sql', text: `${base.fetch.text} -- ${decomposed}` } }),
    ).toEqual(['fetch.text']);
    const [id, ...rest] = base.columns;
    expect(
      refusedAt({ ...base, columns: [{ ...id!, from: { column: decomposed } }, ...rest] }),
    ).toEqual(['columns.0.from.column']);
    // Composed is taken; a decomposed literal is written with PostgreSQL's own escapes.
    expect(refusedAt(definition({ title: decomposed.normalize('NFC') }))).toEqual([]);
    expect(
      refusedAt({
        ...base,
        fetch: { kind: 'sql', text: `${base.fetch.text} -- ${"U&'cafe\\0301'"}` },
      }),
    ).toEqual([]);
  });

  it('refuses a string Postgres could not store, naming the member', () => {
    expect(refusedAt(definition({ title: `a${String.fromCharCode(0xd800)}` }))).toContain('title');
    expect(refusedAt(definition({ description: `a${String.fromCharCode(0)}` }))).toContain(
      'description',
    );
  });

  it('is sampled as a draft: the whole shape but its title, description and retirement', () => {
    const { title, description, retired, ...draft } = definition();
    void title;
    void description;
    void retired;
    expect(draftDefinitionSchema.parse(draft)).toEqual(draft);
    expect(parseDraftDefinition(draft)).toEqual(draft);
    expect(() => parseDraftDefinition({ ...draft, key: ['nothing'] })).toThrow(DefinitionRefused);
    expect(draftDefinitionSchema.safeParse({ ...draft, title: 'x' }).success).toBe(false);
  });

  it('refuses a fragment that runs into the SQL around it where it is placed, so every definition that passes can be bound', () => {
    const backslash = String.fromCharCode(92);
    const placed = (text: string, fragment: string): QueryDefinition =>
      withParameters(
        [
          { name: 'v', type: { base: 'integer' }, required: true, list: false },
          {
            name: 'f',
            type: { base: 'text' },
            required: true,
            list: false,
            variation: [
              { key: 'plain', sql: 'x' },
              { key: 'joined', sql: fragment },
            ],
          },
        ],
        text,
      );
    // A minus before a minus makes a comment of the value's placeholder; an E before a quote makes an
    // escape string that swallows it. Each fragment lexes whole on its own, and the text around it too.
    for (const [text, fragment] of [
      ['select 1 -{{#f}}{{v}} as id', '-'],
      [`select {{#f}}'${backslash}' as a, {{v}} as id --'`, 'E'],
    ] as const) {
      const definition = placed(text, fragment);
      expect(refusedAt(definition), text).toEqual(['parameters.1.variation.1.sql']);
      const { title, description, retired, ...draft } = definition;
      void [title, description, retired];
      expect(() => parseDraftDefinition(draft), text).toThrow(DefinitionRefused);
      try {
        parseQueryDefinitionForWrite(definition);
      } catch (error) {
        expect((error as DefinitionRefused).problems[0]!.message).toMatch(/runs into/);
      }
    }
    // The same fragments where they run into nothing are taken.
    expect(refusedAt(placed('select 1 - {{#f}} {{v}} as id', '-'))).toEqual([]);
    expect(refusedAt(placed('select {{#f}} {{v}} as id', 'E'))).toEqual([]);
  });

  it("counts a permitted text value's length in characters, as a parameter's value is counted", () => {
    const astral = String.fromCodePoint(0x1f600);
    const permitting = (value: string) =>
      withParameters(
        [
          {
            name: 'label',
            type: { base: 'text' },
            required: true,
            list: false,
            permitted: { values: [value] },
          },
        ],
        'select id, taken, value from sample.reading where {{label}} is not null order by id',
      );
    // A thousand characters beyond the Basic Multilingual Plane are two thousand UTF-16 units.
    expect(refusedAt(permitting(astral.repeat(1000)))).toEqual([]);
    expect(
      checkParameterValues(permitting(astral.repeat(1000)).parameters, {
        label: astral.repeat(1000),
      }),
    ).toEqual([]);
    expect(refusedAt(permitting(astral.repeat(1001)))).toEqual(['parameters.0.permitted']);
  });

  it('is at most 512 KiB of canonical JSON, so that it can always be sent to be run', () => {
    const LIMIT = 512 * 1024;
    const bytes = (value: unknown) => new TextEncoder().encode(canonicalJson(value)).length;
    /** A definition whose canonical JSON is exactly `size` bytes, its bulk a text parameter's permitted values. */
    const sized = (size: number) => {
      const values: string[] = [];
      const made = () =>
        withParameters(
          [
            ...definition().parameters,
            {
              name: 'label',
              type: { base: 'text' },
              required: false,
              list: false,
              permitted: { values },
            },
          ],
          'select id, taken, value from sample.reading where site = {{site}} and {{label}} is not null order by {{#sort}}',
        );
      // Whole values of three-byte characters while more than one would still fit, then one value
      // made up to the size exactly: three-byte characters, then single bytes.
      for (;;) {
        values.push(`${values.length}${'一'.repeat(980)}`);
        if (bytes(made()) > size - 16) break;
      }
      values.pop();
      values.push(`${values.length}`);
      const left = size - bytes(made());
      values[values.length - 1] += '一'.repeat(Math.floor(left / 3)) + 'a'.repeat(left % 3);
      const whole = made();
      expect(bytes(whole)).toBe(size);
      return whole;
    };
    expect(refusedAt(sized(LIMIT))).toEqual([]);
    expect(refusedAt(sized(LIMIT + 1))).toEqual(['']);
    // A draft is held to the same bound: this one is over it without its title and description.
    const { title, description, retired, ...draft } = sized(LIMIT + 1000);
    void [title, description, retired];
    expect(bytes(draft)).toBeGreaterThan(LIMIT);
    expect(() => parseDraftDefinition(draft)).toThrow(DefinitionRefused);
  });

  it('binds to at most 300,000 characters of SQL with its longest fragments, so that what ran can always be reported', () => {
    const LIMIT = 300_000;
    const fragment = `/*${'x'.repeat(1996)}*/`;
    /** SQL placing the longest fragment 149 times, padded by a comment to bind to `length` exactly. */
    const binding = (length: number) => {
      const placed = `select 1::int8 as id, {{site}} as site${' {{#sort}}'.repeat(149)}`;
      const sort: Parameter = {
        name: 'sort',
        type: { base: 'text' },
        required: true,
        list: false,
        variation: [
          { key: 'short', sql: '/**/' },
          { key: 'long', sql: fragment },
        ],
      };
      const site = definition().parameters[0]!;
      const unpadded = bindPostgres(withParameters([site, sort], placed), {
        site: '1',
        sort: 'long',
      });
      const pad = length - unpadded.text.length;
      const made = withParameters([site, sort], `${placed} /*${'y'.repeat(pad - 5)}*/`);
      expect(bindPostgres(made, { site: '1', sort: 'long' }).text.length).toBe(length);
      return made;
    };
    expect(refusedAt(binding(LIMIT))).toEqual([]);
    expect(refusedAt(binding(LIMIT + 1))).toEqual(['fetch.text']);
  });
});
