import { describe, expect, it } from 'vitest';

import {
  checkQueryDefinition,
  connectionFetchProblems,
  type DraftDefinition,
  type Parameter,
} from './definition.js';
import {
  bindHttp,
  httpTemplateSchema,
  httpValueProblems,
  HttpValueRefused,
  percentEncode,
  type HttpTemplate,
} from './http-template.js';
import type { ConnectionSettings } from './connection.js';

const parameter = (name: string, over: Partial<Parameter> = {}): Parameter => ({
  name,
  type: { base: 'text' },
  required: true,
  list: false,
  ...over,
});

const parameters: Parameter[] = [
  parameter('site'),
  parameter('since', { type: { base: 'date' }, required: false }),
  parameter('tags', { list: true, required: false }),
  parameter('trace', { required: false }),
  parameter('depth', { type: { base: 'decimal', precision: 10, scale: 2 }, required: false }),
  parameter('active', { type: { base: 'boolean' }, required: false }),
];

const template: HttpTemplate = httpTemplateSchema.parse({
  method: 'POST',
  path: [{ fixed: 'sites' }, { parameter: 'site' }, { fixed: 'readings' }],
  query: [
    { name: 'since', value: { parameter: 'since' } },
    { name: 'tag', value: { parameter: 'tags' } },
    { name: 'format', value: { fixed: 'json' } },
  ],
  headers: [
    { name: 'x-trace', value: { parameter: 'trace' } },
    { name: 'accept-language', value: { fixed: 'en' } },
  ],
  body: {
    object: [
      { name: 'depth', value: { parameter: 'depth' } },
      { name: 'active', value: { parameter: 'active' } },
      { name: 'tags', value: { parameter: 'tags' } },
      { name: 'limit', value: { number: '100' } },
      { name: 'note', value: { fixed: 'a "quoted" note' } },
      { name: 'nested', value: { array: [{ fixed: null }, { fixed: true }] } },
    ],
  },
});

const draft = (over: Partial<DraftDefinition> = {}): DraftDefinition => ({
  schemaVersion: 1,
  connection: '0e5b5d5a-6b8e-4c1e-9b3a-1f6a2b7c8d9e',
  parameters,
  fetch: { kind: 'http', request: template, format: { kind: 'json', rows: '/items' } },
  columns: [{ name: 'id', from: { pointer: '/id' }, type: { base: 'integer' } }],
  key: [],
  order: 'multiset',
  empty: 'valid',
  limits: { rows: 100, bytes: 1_000_000, seconds: 10 },
  ...over,
});

describe('an HTTP request template', () => {
  it('DAT-104 places each part by its position: path segments, query pairs, headers and a JSON body', () => {
    const bound = bindHttp(template, parameters, {
      site: 'north east#1?',
      since: '2026-01-02',
      tags: ['a&b', 'ünï'],
      trace: 'abc-123',
      depth: '12.5',
      active: true,
    });
    expect(bound).toEqual({
      method: 'POST',
      // The value is one segment, its delimiters escaped.
      path: '/sites/north%20east%231%3F/readings',
      // A list as its name repeated; every byte but the unreserved set escaped.
      query: 'since=2026-01-02&tag=a%26b&tag=%C3%BCn%C3%AF&format=json',
      headers: [
        ['x-trace', 'abc-123'],
        ['accept-language', 'en'],
      ],
      // A number from its canonical text, a list as an array, members in the template's order.
      body: '{"depth":12.5,"active":true,"tags":["a&b","ünï"],"limit":100,"note":"a \\"quoted\\" note","nested":[null,true]}',
    });
    expect(JSON.parse(bound.body!)).toMatchObject({ depth: 12.5, tags: ['a&b', 'ünï'] });
  });

  it('leaves out a query pair and a header whose value is absent, and writes null in a body', () => {
    const bound = bindHttp(template, parameters, { site: 'north' });
    expect(bound.path).toBe('/sites/north/readings');
    expect(bound.query).toBe('format=json');
    expect(bound.headers).toEqual([['accept-language', 'en']]);
    expect(JSON.parse(bound.body!)).toMatchObject({ depth: null, active: null, tags: null });
  });

  it('percent-encodes all but the unreserved characters, a character outside ASCII by its UTF-8', () => {
    expect(percentEncode('AZaz09-._~')).toBe('AZaz09-._~');
    expect(percentEncode(' !"#$%&\'()*+,/:;=?@[]')).toBe(
      '%20%21%22%23%24%25%26%27%28%29%2A%2B%2C%2F%3A%3B%3D%3F%40%5B%5D',
    );
    expect(percentEncode(String.fromCodePoint(0x1f600))).toBe('%F0%9F%98%80');
  });

  it('refuses a value its position cannot carry, naming the parameter, and binds nothing', () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ site: '..' }, 'site'],
      [{ site: '.' }, 'site'],
      [{ site: '' }, 'site'],
      [{ site: 'a\u0000b' }, 'site'],
      [{ site: `a${String.fromCharCode(92)}b` }, 'site'],
      [{ site: 'ok', trace: 'a\r\nx-admin: yes' }, 'trace'],
      [{ site: 'ok', trace: ' padded' }, 'trace'],
      [{ site: 'ok', trace: 'tab\there' }, 'trace'],
      [{ site: 'ok', trace: 'ünï' }, 'trace'],
    ];
    for (const [values, named] of cases) {
      expect(() => bindHttp(template, parameters, values as never), JSON.stringify(values)).toThrow(
        HttpValueRefused,
      );
      expect(httpValueProblems(template, values as never)).toEqual([
        expect.objectContaining({ parameter: named, rule: 'position' }),
      ]);
    }
    // A path segment's value absent is refused, required.
    expect(httpValueProblems(template, {})).toEqual([
      { parameter: 'site', rule: 'required', value: '' },
    ]);
  });

  it("holds a template to its parameters and its positions' rules", () => {
    expect(checkQueryDefinition(draft())).toEqual([]);
    const problems = (over: Partial<HttpTemplate>, declared = parameters) =>
      checkQueryDefinition(
        draft({
          parameters: declared,
          fetch: {
            kind: 'http',
            request: { ...template, ...over },
            format: { kind: 'json', rows: '/items' },
          },
        }),
      ).map((each) => each.message);
    expect(problems({ path: [{ parameter: 'nobody' }] })).toContain(
      'The template names nobody, which is not a declared parameter',
    );
    expect(problems({ path: [{ parameter: 'tags' }] })).toContain(
      'tags is a list, which a path segment cannot carry',
    );
    expect(problems({ path: [{ parameter: 'since' }] })).toContain(
      'since stands in the path, so it is required',
    );
    expect(problems({ headers: [{ name: 'x-tags', value: { parameter: 'tags' } }] })).toContain(
      'tags is a list, which a header cannot carry',
    );
    expect(problems({ path: [{ fixed: '..' }] })).toContain('A path segment is not empty, . or ..');
    expect(problems({ path: [{ fixed: 'a/b' }] })).toContain(
      'A path segment holds no slash or backslash',
    );
    expect(
      problems({
        headers: [
          { name: 'x-one', value: { fixed: 'a' } },
          { name: 'x-one', value: { fixed: 'b' } },
        ],
      }),
    ).toContain('A header is named once');
    expect(problems({ headers: [{ name: 'x-one', value: { fixed: 'a\r\nb' } }] })).toContain(
      'A header value is printable ASCII: no line break or other control character',
    );
    expect(problems({ method: 'GET' })).toContain('A body is sent with a POST alone');
    expect(problems({ body: undefined, query: [], headers: [] }, [parameter('site')])).toEqual([]);
    expect(problems({ body: undefined })).toContain(
      'The template does not use the parameter depth',
    );
    let deep: unknown = { fixed: 1 > 0 };
    for (let at = 0; at < 17; at += 1) deep = { array: [deep] };
    expect(problems({ body: deep as never })).toContain('A body nests at most 16 levels');
    // A header neither a template nor a secret may name, by the shape.
    for (const name of ['host', 'content-length', 'cookie', 'transfer-encoding', 'X-Upper']) {
      expect(
        httpTemplateSchema.safeParse({ ...template, headers: [{ name, value: { fixed: 'x' } }] })
          .success,
        name,
      ).toBe(false);
    }
    // A number in the body is canonical decimal.
    for (const number of ['1e3', '01', '1.50', '-0', 'NaN']) {
      expect(httpTemplateSchema.safeParse({ ...template, body: { number } }).success, number).toBe(
        false,
      );
    }
  });

  it('reads an HTTP response by pointers, and a query by column names', () => {
    const byColumn = checkQueryDefinition(
      draft({ columns: [{ name: 'id', from: { column: 'id' }, type: { base: 'integer' } }] }),
    );
    expect(byColumn).toContainEqual({
      rule: 'definition_invalid',
      path: 'columns.0.from',
      message: 'A column of JSON is read by a pointer into its row',
    });
    const sql = checkQueryDefinition(
      draft({
        parameters: [],
        fetch: { kind: 'sql', text: 'select 1 as id' },
        columns: [{ name: 'id', from: { pointer: '/id' }, type: { base: 'integer' } }],
      }),
    );
    expect(sql).toContainEqual({
      rule: 'definition_invalid',
      path: 'columns.0.from',
      message: "A column of a query is read by the query's column name",
    });
  });

  it('suits a fetch to its connection: HTTP on HTTP, never naming the secret header; a query on a database', () => {
    const http: Pick<ConnectionSettings, 'type' | 'source'> = {
      type: 'http',
      source: { baseUrl: 'https://api.example.test', secretHeader: 'x-trace' },
    };
    const postgres: Pick<ConnectionSettings, 'type' | 'source'> = {
      type: 'postgres',
      source: { host: 'db', port: 5432, database: 'd', account: 'a', tls: 'require' },
    };
    const fetch = draft().fetch;
    expect(connectionFetchProblems(fetch, postgres)).toEqual([
      {
        rule: 'definition_invalid',
        path: 'fetch',
        message: 'An HTTP request is sent on an HTTP connection',
      },
    ]);
    expect(connectionFetchProblems(fetch, http)).toEqual([
      {
        rule: 'definition_invalid',
        path: 'fetch.request.headers.0.name',
        message: 'The connection sends its secret in this header, so the template may not name it',
      },
    ]);
    expect(
      connectionFetchProblems(fetch, {
        ...http,
        source: { baseUrl: 'https://api.example.test', secretHeader: 'x-api-key' },
      }),
    ).toEqual([]);
    expect(connectionFetchProblems({ kind: 'sql', text: 'select 1' }, http)).toEqual([
      {
        rule: 'definition_invalid',
        path: 'fetch',
        message: 'A query, written or built, runs on a database connection',
      },
    ]);
    expect(connectionFetchProblems({ kind: 'sql', text: 'select 1' }, postgres)).toEqual([]);
  });
});
