import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../stored/canonical.js';
import { extensionManifestSchema, manifestDigestInput, readManifest } from './manifest.js';

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

/** An invented reference extension's manifest (the XR plan, XR-J). */
const REFERENCE = {
  manifest: 1,
  name: 'Herbarium records',
  version: '0.3.0',
  publisher: 'Invented Herbarium',
  description: 'Specimen papers by catalogue number.',
  kind: 'reference',
  endpoint: 'https://herbarium.example.test/alloy',
  reference: { search: '/search', fetch: '/records' },
  authentication: 'none',
  outbound: [{ host: 'herbarium.example.test', purpose: 'The terms searched for' }],
};

describe('a reference extension’s manifest (the XR plan, XR-J)', () => {
  it('LIB-032 reads a manifest of kind reference, its search and fetch paths under its endpoint', () => {
    expect(readManifest(REFERENCE)).toEqual({ ok: true, manifest: REFERENCE });
    expect(readManifest(MANIFEST)).toEqual({ ok: true, manifest: MANIFEST });
  });

  it("keeps a source manifest's digest input as it was", () => {
    const read = readManifest(MANIFEST);
    expect(read.ok && manifestDigestInput(read.manifest)).toBe(canonicalJson(MANIFEST));
  });

  it('refuses a path that is not a plain path, and settings or capabilities it does not take', () => {
    for (const search of ['search', '/../admin', '/search?q=1', '/a#b', '//other.test/x']) {
      expect(
        readManifest({ ...REFERENCE, reference: { ...REFERENCE.reference, search } }).ok,
        search,
      ).toBe(false);
    }
    expect(readManifest({ ...REFERENCE, settings: [] })).toEqual({ ok: false, paths: ['(top)'] });
    expect(readManifest({ ...REFERENCE, kind: 'output' }).ok).toBe(false);
  });
});
