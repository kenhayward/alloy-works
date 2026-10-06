import { describe, expect, it } from 'vitest';

import type { ConnectionSettings } from './connection.js';
import {
  checkQueryDefinition,
  connectionFetchProblems,
  indexLetter,
  letterIndex,
  parseDraftDefinition,
  sampleDraft,
  type DraftDefinition,
  type Parameter,
} from './definition.js';
import {
  bindObjectKey,
  keyPairText,
  objectKeyProblems,
  ObjectKeyRefused,
  parseKeyPair,
  type ObjectKey,
} from './s3.js';

const parameter = (name: string, over: Partial<Parameter> = {}): Parameter => ({
  name,
  type: { base: 'text' },
  required: true,
  list: false,
  ...over,
});

const key: ObjectKey = [{ fixed: 'readings' }, { parameter: 'year' }, { fixed: 'readings.csv' }];
const CSV = { kind: 'csv', delimiter: 'comma', headerRow: true, null: 'empty' } as const;

const draft = (over: Partial<DraftDefinition> = {}): DraftDefinition => ({
  schemaVersion: 1,
  connection: '0e5b5d5a-6b8e-4c1e-9b3a-1f6a2b7c8d9e',
  parameters: [parameter('year', { type: { base: 'integer' } })],
  fetch: { kind: 'file', key, format: CSV },
  columns: [{ name: 'site', from: { header: 'site' }, type: { base: 'text' } }],
  key: [],
  order: 'multiset',
  empty: 'valid',
  limits: { rows: 100, bytes: 1_000_000, seconds: 10 },
  ...over,
});

const s3: Pick<ConnectionSettings, 'type' | 'source'> = {
  type: 's3',
  source: {
    endpoint: 'https://s3.example.test',
    region: 'eu-west-2',
    bucket: 'alloy-readings',
    pathStyle: false,
  },
};

describe("a file's object key", () => {
  it('DAT-081 places each value whole in its own segment, percent-encoded, so no value reads as a delimiter', () => {
    expect(bindObjectKey(key, { year: '2026' })).toEqual({
      key: 'readings/2026/readings.csv',
      path: '/readings/2026/readings.csv',
    });
    const spaced = bindObjectKey([{ fixed: 'sites' }, { parameter: 'site' }], {
      site: 'North weir?#&=%2F',
    });
    expect(spaced).toEqual({
      key: 'sites/North weir?#&=%2F',
      path: '/sites/North%20weir%3F%23%26%3D%252F',
    });
    expect(bindObjectKey([{ parameter: 'site' }], { site: 'Ω東京' }).path).toBe(
      '/%CE%A9%E6%9D%B1%E4%BA%AC',
    );
  });

  it('DAT-081 refuses a value a segment cannot carry: empty, a dot or two, a slash, a backslash, a control character, a list, or a key past 1,024 bytes', () => {
    const one: ObjectKey = [{ fixed: 'sites' }, { parameter: 'site' }];
    for (const site of [
      '',
      '.',
      '..',
      'a/b',
      '../admin',
      `a${String.fromCharCode(92)}b`,
      `a${String.fromCharCode(0)}`,
      `a${String.fromCharCode(13, 10)}b`,
      'x'.repeat(1020),
    ]) {
      expect(objectKeyProblems(one, { site }), JSON.stringify(site)).toEqual([
        { parameter: 'site', rule: 'position', value: site },
      ]);
      expect(() => bindObjectKey(one, { site })).toThrow(ObjectKeyRefused);
    }
    expect(objectKeyProblems(one, { site: ['a'] })).toEqual([
      { parameter: 'site', rule: 'position', value: '["a"]' },
    ]);
    expect(objectKeyProblems(one, {})).toEqual([
      { parameter: 'site', rule: 'required', value: '' },
    ]);
  });

  it("checks a key's fixed segments and its parameters as a path's, and every parameter placed in the key or the filter", () => {
    expect(checkQueryDefinition(draft())).toEqual([]);
    const problems = (over: Partial<DraftDefinition>) =>
      checkQueryDefinition(draft(over)).map((each) => `${each.path}: ${each.message}`);
    expect(
      problems({
        fetch: { kind: 'file', key: [{ fixed: '..' }, { parameter: 'year' }], format: CSV },
      }),
    ).toEqual(['fetch.key.0: A key segment is not empty, . or ..']);
    expect(
      problems({
        parameters: [
          parameter('year', { list: true }),
          parameter('site', { required: false }),
          parameter('spare'),
        ],
        fetch: {
          kind: 'file',
          key: [{ parameter: 'year' }, { parameter: 'site' }, { parameter: 'other' }],
          format: CSV,
        },
      }),
    ).toEqual([
      'fetch.key.0: year is a list, which a key segment cannot carry',
      'fetch.key.1: site stands in the key, so it is required',
      'fetch.key.2: The key names other, which is not a declared parameter',
      'parameters.2: Neither the key nor the filter uses spare',
    ]);
    expect(
      problems({
        parameters: [],
        fetch: { kind: 'file', key: [{ fixed: 'x'.repeat(1025) }], format: CSV },
      }),
    ).toEqual(['fetch.key: A key is at most 1,024 bytes']);
  });

  it('reads a CSV column by its header or its letter, a header only where the first record is one, and JSON by a pointer', () => {
    const fromProblems = (format: DraftDefinition['fetch'], from: object) =>
      checkQueryDefinition(
        draft({
          fetch: format,
          columns: [{ name: 'site', from, type: { base: 'text' } } as never],
        }),
      ).map((each) => each.message);
    const file = (format: object) => ({ kind: 'file', key, format }) as DraftDefinition['fetch'];
    expect(fromProblems(file(CSV), { letter: 'B' })).toEqual([]);
    expect(fromProblems(file({ ...CSV, headerRow: false }), { header: 'site' })).toEqual([
      'A CSV whose first record is not a header names its fields by letter',
    ]);
    expect(fromProblems(file(CSV), { pointer: '/site' })).toEqual([
      'A column of a CSV is read by its header or its letter',
    ]);
    expect(fromProblems(file({ kind: 'jsonLines' }), { header: 'site' })).toEqual([
      'A column of JSON is read by a pointer into its row',
    ]);
    expect(letterIndex('A')).toBe(0);
    expect(letterIndex('Z')).toBe(25);
    expect(letterIndex('AA')).toBe(26);
    for (const at of [0, 25, 26, 701, 702, 16383]) expect(letterIndex(indexLetter(at))).toBe(at);
  });

  it('reads a file on an S3 connection alone, and no other fetch on one', () => {
    expect(connectionFetchProblems(draft().fetch, s3)).toEqual([]);
    expect(
      connectionFetchProblems(draft().fetch, {
        type: 'http',
        source: { baseUrl: 'https://api.example.test', secretHeader: 'x-api-key' },
      }),
    ).toEqual([
      { rule: 'definition_invalid', path: 'fetch', message: 'A file is read on an S3 connection' },
    ]);
    expect(connectionFetchProblems({ kind: 'sql', text: 'select 1' }, s3)).toHaveLength(1);
    // A sample's draft holds the fetch and a placeholder its format reads.
    expect(
      checkQueryDefinition(sampleDraft(draft().parameters, { kind: 'file', key, format: CSV })),
    ).toEqual([]);
    expect(() =>
      parseDraftDefinition({ ...draft(), fetch: { kind: 'file', key: [], format: CSV } }),
    ).toThrow();
  });
});

describe("an S3 connection's key pair", () => {
  it('is sealed as JSON of its two members in one order, and read back only whole', () => {
    const pair = { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'abc/def+ghi=' };
    expect(keyPairText(pair)).toBe(
      '{"accessKeyId":"AKIAEXAMPLE","secretAccessKey":"abc/def+ghi="}',
    );
    expect(parseKeyPair(keyPairText(pair))).toEqual(pair);
    for (const text of [
      'abc',
      '{}',
      '{"accessKeyId":"a"}',
      '{"accessKeyId":"a b","secretAccessKey":"c"}',
      '{"accessKeyId":"a","secretAccessKey":"c","more":1}',
      '{"accessKeyId":"a","secretAccessKey":""}',
    ]) {
      expect(parseKeyPair(text), text).toBeUndefined();
    }
  });
});
