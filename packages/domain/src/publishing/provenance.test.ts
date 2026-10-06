import { describe, expect, it } from 'vitest';

import type { Provenance } from '../data/provenance.js';

import type { PrintedValue } from './bind.js';
import { provenanceBytes, publishedProvenance } from './provenance.js';

/**
 * `provenance.json` (the B3 plan, B3-G): built from an allow-list, so nothing of the SQL, the
 * connection or a column's source reaches a reader of the publication, whatever D3 stores.
 */

const NODE = 'calib'.padEnd(26, 'a');
const VERSION = '00000000-0000-4000-8000-0000000000d1';
const SECRET_SQL = 'select reading_kpa from secret_schema.gauges where site = $1';
const CONNECTION = '00000000-0000-4000-8000-0000000000c1';

const stored: Provenance = {
  schemaVersion: 1,
  queryDefinition: {
    artifact: '00000000-0000-4000-8000-0000000000aa',
    version: '00000000-0000-4000-8000-0000000000ab',
  },
  connection: { artifact: CONNECTION, version: '00000000-0000-4000-8000-0000000000c2' },
  parameters: { site: 'north' },
  ran: { sql: SECRET_SQL },
  identity: { kind: 'service' },
  at: '2026-10-05T09:00:00.000Z',
  durationMs: 12,
  rowCount: 1,
  columns: [
    {
      name: 'reading',
      from: { column: 'reading_kpa_hidden' },
      type: { base: 'decimal', precision: 10, scale: 2 },
    },
  ],
  canonical: 1,
  checksum: 'a'.repeat(64),
  images: {},
};

const value: PrintedValue = {
  node: NODE,
  block: 'p1',
  binding: 'b1',
  take: { column: 'reading' },
  printed: '4,200.50',
  value: '4200.5',
  column: { name: 'reading', type: { base: 'decimal', precision: 10, scale: 2 } },
  datasetVersion: VERSION,
};

const datasets = new Map([
  [
    VERSION,
    {
      id: '00000000-0000-4000-8000-0000000000d0',
      name: 'Gauges',
      number: '0.1',
      provenance: stored,
    },
  ],
]);
const numbering = {
  scheme: 'default',
  entries: [{ node: NODE, block: null, sequence: 'section', number: '1', label: null }],
} as never;

describe('publishedProvenance', () => {
  it('records each value: where, what was printed and from what, and the result it was taken from', () => {
    expect(publishedProvenance([value], datasets, numbering)).toEqual({
      schemaVersion: 2,
      values: [
        {
          node: NODE,
          number: '1',
          block: 'p1',
          binding: 'b1',
          printed: '4,200.50',
          value: '4200.5',
          column: { name: 'reading', type: { base: 'decimal', precision: 10, scale: 2 } },
          take: { column: 'reading' },
          dataset: {
            id: '00000000-0000-4000-8000-0000000000d0',
            name: 'Gauges',
            version: VERSION,
            number: '0.1',
          },
          result: {
            queryDefinition: stored.queryDefinition,
            parameters: { site: 'north' },
            identity: { kind: 'service' },
            at: stored.at,
            durationMs: 12,
            rowCount: 1,
            columns: [{ name: 'reading', type: { base: 'decimal', precision: 10, scale: 2 } }],
            canonical: 1,
            checksum: 'a'.repeat(64),
          },
        },
      ],
    });
  });

  it('records a bound image at schema 2 by its hash, the asset version it was placed as and its description, and no printed value', () => {
    const type = { base: 'image', encoding: 'binary', description: { column: 'caption' } } as const;
    const image: PrintedValue = {
      node: NODE,
      block: 'f1',
      binding: 'i1',
      take: { column: 'photo' },
      image: { hash: 'a1'.repeat(32), assetVersion: '00000000-0000-4000-8000-00000000a501' },
      description: 'The north gate',
      column: { name: 'photo', type },
      datasetVersion: VERSION,
    };
    const made = publishedProvenance([value, image], datasets, numbering);
    expect(made.schemaVersion).toBe(2);
    const [, recorded] = made.values;
    expect(recorded).toMatchObject({
      block: 'f1',
      binding: 'i1',
      image: { hash: 'a1'.repeat(32), assetVersion: '00000000-0000-4000-8000-00000000a501' },
      description: 'The north gate',
      column: { name: 'photo', type },
      dataset: { version: VERSION },
    });
    expect(recorded).not.toHaveProperty('printed');
    expect(recorded).not.toHaveProperty('value');
  });

  it('holds no SQL, no connection and no column source, whatever the stored provenance carries beside them', () => {
    // A member D3 might add later is left out too: only what the allow-list names is copied.
    const later = { ...stored, credentialHint: 'never-this' } as unknown as Provenance;
    const bytes = new TextDecoder().decode(
      provenanceBytes(
        publishedProvenance(
          [value],
          new Map([[VERSION, { ...datasets.get(VERSION)!, provenance: later }]]),
          numbering,
        ),
      ),
    );
    for (const secret of [
      SECRET_SQL,
      'secret_schema',
      CONNECTION,
      'reading_kpa_hidden',
      '"ran"',
      '"connection"',
      '"from"',
      'never-this',
    ]) {
      expect(bytes).not.toContain(secret);
    }
  });

  it('is serialised with sorted keys, so the same publication makes the same bytes', () => {
    const made = provenanceBytes(publishedProvenance([value], datasets, numbering));
    const again = provenanceBytes(
      publishedProvenance([{ ...value }], new Map(datasets), numbering),
    );
    expect(Buffer.from(made).equals(Buffer.from(again))).toBe(true);
    const text = new TextDecoder().decode(made);
    const keys = Object.keys(JSON.parse(text).values[0]);
    expect(keys).toEqual([...keys].sort());
  });
});
