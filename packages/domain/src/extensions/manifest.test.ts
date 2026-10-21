import { describe, expect, it } from 'vitest';
import { extensionManifestSchema, readManifest } from './manifest.js';

/** An invented extension's manifest. */
const MANIFEST = {
  manifest: 1,
  name: 'Gauge readings',
  version: '1.2.0',
  publisher: 'Invented Instruments',
  description: 'River gauge readings by site.',
  kind: 'source',
  endpoint: 'https://gauges.example.test/alloy',
  settings: [{ key: 'region', label: 'Region', type: 'text', required: true }],
  authentication: { label: 'API key' },
  capabilities: { parameters: true, keyColumns: false, rowLimit: true },
  outbound: [{ host: 'gauges.example.test', purpose: 'The readings asked for' }],
};

describe('an extension’s manifest (the EX plan, EX-A)', () => {
  it('reads a manifest that says what it is, takes and does, and where it sends data', () => {
    expect(readManifest(MANIFEST)).toEqual({ ok: true, manifest: MANIFEST });
  });

  it('refuses a member it does not know, naming where it stood and never its key or value', () => {
    const answer = readManifest({ ...MANIFEST, internalSecretField: 'hunter2' });
    expect(answer).toEqual({ ok: false, paths: ['(top)'] });
    expect(JSON.stringify(answer)).not.toContain('internalSecretField');
    expect(JSON.stringify(answer)).not.toContain('hunter2');
  });

  it('refuses an endpoint that is not plain https, and a setting named twice', () => {
    for (const endpoint of [
      'http://gauges.example.test',
      'https://user:pass@gauges.example.test',
      'https://gauges.example.test/?key=1',
    ]) {
      expect(extensionManifestSchema.safeParse({ ...MANIFEST, endpoint }).success, endpoint).toBe(
        false,
      );
    }
    expect(
      extensionManifestSchema.safeParse({
        ...MANIFEST,
        settings: [MANIFEST.settings[0], MANIFEST.settings[0]],
      }).success,
    ).toBe(false);
  });
});
