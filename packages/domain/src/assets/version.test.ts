import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../stored/canonical.js';
import { canonicaliseVersionContent } from '../version/substance.js';
import { ASSET_SCHEMA_VERSION, assetAlternativeSchema, parseAssetVersion } from './version.js';

const KEY = `t_acme/sha256/${'a'.repeat(64)}`;
const version = (over: Record<string, unknown> = {}) => ({
  schemaVersion: ASSET_SCHEMA_VERSION,
  object: KEY,
  format: 'jpeg',
  bytes: 430_000,
  width: 500,
  height: 800,
  orientation: 6,
  colour: 'rgb',
  alpha: false,
  depth: 8,
  resolution: null,
  alternative: { text: 'A red square beside a blue circle', language: 'en-GB' },
  ...over,
});

describe("an asset version's stored shape (figures 1)", () => {
  it('AST-005 AST-041 AST-012 holds the key, the intrinsic properties and a default description in a language', () => {
    expect(ASSET_SCHEMA_VERSION).toBe(1);
    expect(parseAssetVersion(version())).toEqual(version());
    expect(parseAssetVersion(version({ alternative: null, resolution: 300 }))).toMatchObject({
      alternative: null,
      resolution: 300,
    });
  });

  it('refuses a member it does not name, and every member out of its range', () => {
    const refused: Record<string, unknown>[] = [
      { extra: true },
      { format: 'gif' },
      { object: 'somewhere/else' },
      { object: `t_acme/sha256/${'A'.repeat(64)}` },
      { bytes: 0 },
      { bytes: 25_000_001 },
      { width: 0 },
      { height: 1.5 },
      { width: 8000, height: 8000 },
      { orientation: 0 },
      { orientation: 9 },
      { colour: 'lab' },
      { depth: 12 },
      { resolution: 0 },
      { resolution: -1 },
      { schemaVersion: 2 },
    ];
    for (const change of refused) {
      expect(() => parseAssetVersion(version(change)), JSON.stringify(change)).toThrow();
    }
  });

  it('refuses a description that says nothing, is too long, cannot be stored or has no well-formed language', () => {
    const refused = [
      { text: '', language: 'en' },
      { text: '   ', language: 'en' },
      { text: 'x'.repeat(2001), language: 'en' },
      { text: `A${String.fromCharCode(0)}B`, language: 'en' },
      { text: 'A square', language: 'english' },
      { text: 'A square' },
    ];
    for (const alternative of refused) {
      expect(
        assetAlternativeSchema.safeParse(alternative).success,
        JSON.stringify(alternative),
      ).toBe(false);
    }
    expect(
      assetAlternativeSchema.safeParse({ text: 'x'.repeat(2000), language: 'de' }).success,
    ).toBe(true);
  });

  it('canonicalises by the shared rule, as a layout does: no array in it is a set', () => {
    const content = parseAssetVersion(version());
    expect(canonicaliseVersionContent({ kind: 'asset', content })).toBe(canonicalJson(content));
  });
});
