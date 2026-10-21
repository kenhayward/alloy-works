import { describe, expect, it } from 'vitest';

import {
  capabilitiesOf,
  connectionTarget,
  connectorIdentities,
  parseConnectionForWrite,
  type ExtensionSettings,
} from './connection.js';
import { capabilityProblems, checkQueryDefinition, connectionFetchProblems } from './definition.js';

/** A connection to an invented extension, as it was saved against one manifest. */
const settings = (over: Partial<ExtensionSettings['source']> = {}): ExtensionSettings => ({
  schemaVersion: 1,
  name: 'Gauges',
  description: 'River gauges, by an extension.',
  identity: { kind: 'service' },
  retired: false,
  type: 'extension',
  source: {
    extension: '0b6f6b8e-4a39-4c1e-9d0f-3c0a8f1e2d41',
    digest: 'a'.repeat(64),
    endpoint: 'https://gauges.example.test/alloy',
    authenticated: true,
    capabilities: { parameters: false, keyColumns: false, rowLimit: true },
    settings: { region: 'north' },
    ...over,
  },
});

describe('a connection to an extension (the EX plan, EX-D and EX-F)', () => {
  it('DAT-054 holds a source type no part of the product names, its manifest snapshotted', () => {
    expect(parseConnectionForWrite(settings())).toEqual(settings());
  });

  it("binds its credential to the extension's endpoint, so a credential never follows one moved", () => {
    expect(connectionTarget(settings())).not.toBe(
      connectionTarget(settings({ endpoint: 'https://elsewhere.example.test/alloy' })),
    );
    expect(connectionTarget(settings())).toBe(
      connectionTarget(settings({ settings: { region: 'south' } })),
    );
  });

  it('DAT-078 asserts no person’s identity to an extension', () => {
    expect(connectorIdentities.extension).toEqual([]);
    expect(() =>
      parseConnectionForWrite({
        ...settings(),
        identity: { kind: 'endUser', mechanism: 'asserted' },
      }),
    ).toThrow();
  });

  it('DAT-079 refuses parameters on a source that declares none, and binds them on one that does', () => {
    const parameter = { name: 'site', type: 'text', required: true } as never;
    expect(capabilitiesOf(settings())).toEqual({ parameters: false });
    expect(capabilityProblems({ parameters: [parameter] }, settings())).toEqual([
      expect.objectContaining({ path: 'parameters' }),
    ]);
    expect(capabilityProblems({ parameters: [] }, settings())).toEqual([]);
    const declaring = settings({
      capabilities: { parameters: true, keyColumns: false, rowLimit: false },
    });
    expect(capabilityProblems({ parameters: [parameter] }, declaring)).toEqual([]);
    // Every built-in type declares that it binds them.
    for (const type of ['postgres', 'http', 's3'] as const) {
      expect(capabilitiesOf({ type, source: {} } as never).parameters, type).toBe(true);
    }
  });

  it('sends an extension’s request on a connection to an extension alone, its columns read by pointer', () => {
    const fetch = { kind: 'extension', request: { readings: 'daily' } } as const;
    expect(connectionFetchProblems(fetch, settings())).toEqual([]);
    expect(
      connectionFetchProblems(fetch, { type: 'http', source: {} } as never).length,
    ).toBeGreaterThan(0);
    const definition = (from: Record<string, string>) => ({
      schemaVersion: 1,
      connection: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
      parameters: [],
      fetch,
      columns: [{ name: 'level', from, type: 'number' }],
      key: [],
      order: 'multiset',
      empty: 'valid',
      limits: { rows: 100, bytes: 1_000_000, seconds: 10 },
    });
    expect(checkQueryDefinition(definition({ pointer: '/level' }) as never)).toEqual([]);
    expect(checkQueryDefinition(definition({ column: 'level' }) as never)).toEqual([
      expect.objectContaining({ path: 'columns.0.from' }),
    ]);
  });
});
