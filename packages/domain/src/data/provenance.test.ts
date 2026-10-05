import { describe, expect, it } from 'vitest';

import { identityKey, parametersDigestInput } from './identity.js';
import { parseProvenance, parseProvenanceForWrite, type Provenance } from './provenance.js';

/** Invented identifiers: a definition, a connection, and a version of each. */
const DEFINITION = '00000000-0000-4000-8000-00000000d001';
const DEFINITION_VERSION = '00000000-0000-4000-8000-00000000d002';
const CONNECTION = '00000000-0000-4000-8000-00000000c001';
const CONNECTION_VERSION = '00000000-0000-4000-8000-00000000c002';

const ACUTE = String.fromCharCode(0x301);

const record = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  queryDefinition: { artifact: DEFINITION, version: DEFINITION_VERSION },
  connection: { artifact: CONNECTION, version: CONNECTION_VERSION },
  parameters: { site: 'north', ids: ['1', '2'], active: true, since: null },
  ran: { sql: 'select id, depth from sample.reading where site = $1 order by id' },
  identity: { kind: 'service' },
  at: '2026-10-03T09:15:00.123Z',
  durationMs: 42,
  rowCount: 3,
  columns: [
    { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
    { name: 'depth', from: { column: 'depth' }, type: { base: 'decimal', precision: 6, scale: 2 } },
  ],
  canonical: 1,
  checksum: 'a'.repeat(64),
  images: {},
  ...over,
});

describe("a dataset version's provenance record", () => {
  it('reads the record whole, as it was written', () => {
    const read: Provenance = parseProvenance(record());
    expect(read).toEqual(record());
    expect(parseProvenanceForWrite(record())).toEqual(record());
  });

  it('reads the asset version each image hash was admitted as (D8)', () => {
    const images = { ['b'.repeat(64)]: DEFINITION_VERSION };
    expect(parseProvenance(record({ images })).images).toEqual(images);
    expect(parseProvenanceForWrite(record({ images })).images).toEqual(images);
  });

  it('refuses a record missing any member, or holding one more', () => {
    for (const member of Object.keys(record())) {
      const rest: Record<string, unknown> = record();
      delete rest[member];
      expect(() => parseProvenance(rest), member).toThrow();
    }
    expect(() => parseProvenance(record({ result: [] }))).toThrow();
  });

  it('refuses each member that breaks its rule', () => {
    for (const over of [
      { schemaVersion: 2 },
      { queryDefinition: { artifact: DEFINITION } },
      { queryDefinition: { artifact: 'q-1', version: DEFINITION_VERSION } },
      { connection: { artifact: CONNECTION, version: CONNECTION_VERSION.toUpperCase() } },
      { parameters: { Site: 'north' } },
      { parameters: { site: 42 } },
      { parameters: { ids: [] } },
      { parameters: { ids: ['1', null] } },
      // A request is D6's, and never a secret; D3 runs SQL alone.
      { ran: { request: { method: 'GET', target: '/x', headers: [] } } },
      { ran: { sql: '' } },
      { ran: { sql: 'select 1', secret: 'x' } },
      { ran: { sql: 'x'.repeat(300_001) } },
      // An end user's identity is D7's.
      {
        identity: {
          kind: 'endUser',
          mechanism: 'asserted',
          principal: 'p',
          signInRoute: 'r',
          asSeen: 'a',
        },
      },
      { at: '2026-10-03 09:15:00' },
      { at: '2026-10-03T09:15:00+01:00' },
      { at: '2026-13-03T09:15:00Z' },
      { durationMs: -1 },
      { durationMs: 1.5 },
      { rowCount: -1 },
      { columns: [] },
      { columns: [{ name: 'id', type: { base: 'integer' } }] },
      { columns: [{ name: 'id', from: { column: 'id' }, type: { base: 'money' } }] },
      { canonical: 2 },
      { checksum: 'A'.repeat(64) },
      { checksum: 'a'.repeat(63) },
      // An image's hash to the asset version admitted for it (D8): a hash, and a version's identifier.
      { images: { ['B'.repeat(64)]: DEFINITION } },
      { images: { ['b'.repeat(63)]: DEFINITION } },
      { images: { ['b'.repeat(64)]: 'v-1' } },
      { images: { ['b'.repeat(64)]: null } },
    ]) {
      expect(() => parseProvenance(record(over)), JSON.stringify(over)).toThrow();
    }
  });

  it('refuses for a write a record with a string not in NFC, or a column declared twice', () => {
    const decomposed = `cafe${ACUTE}`;
    for (const over of [
      { parameters: { site: decomposed } },
      { ran: { sql: `select '${decomposed}'` } },
      {
        columns: [{ name: decomposed, from: { column: 'id' }, type: { base: 'integer' } }],
      },
      {
        columns: [
          { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
          { name: 'id', from: { column: 'other' }, type: { base: 'integer' } },
        ],
      },
    ]) {
      expect(() => parseProvenanceForWrite(record(over)), JSON.stringify(over)).toThrow();
    }
  });
});

describe("a dataset's identity", () => {
  it("keys a service account's run as the service", () => {
    expect(identityKey({ kind: 'service' })).toBe('service');
  });

  it('writes the parameters canonically: members sorted, lists in order, absent and null alike', () => {
    expect(parametersDigestInput({ site: 'north', ids: ['2', '1'] })).toBe(
      '{"ids":["2","1"],"site":"north"}',
    );
    expect(parametersDigestInput({ ids: ['2', '1'], site: 'north' })).toBe(
      parametersDigestInput({ site: 'north', ids: ['2', '1'] }),
    );
    expect(parametersDigestInput({ ids: ['1', '2'] })).not.toBe(
      parametersDigestInput({ ids: ['2', '1'] }),
    );
    // A parameter left out and one given null run as one question, and are one dataset.
    expect(parametersDigestInput({ site: 'north', since: null })).toBe(
      parametersDigestInput({ site: 'north' }),
    );
    expect(parametersDigestInput({ site: 'north', since: undefined })).toBe(
      parametersDigestInput({ site: 'north' }),
    );
    expect(parametersDigestInput({})).toBe('{}');
    // A boolean is not its text.
    expect(parametersDigestInput({ active: true })).not.toBe(
      parametersDigestInput({ active: 'true' }),
    );
  });
});
