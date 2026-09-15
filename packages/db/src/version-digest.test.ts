import {
  canonicalise,
  canonicaliseVersion,
  DEFINITION_SCHEMA_VERSION,
  fieldDefinitionSchema,
  type ComponentSubstance,
} from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { sha256Hex, versionDigests } from './version-digest.js';

// The version the domain package pins its serialisation against, in
// packages/domain/src/version/substance.test.ts.
const component: ComponentSubstance = {
  kind: 'component',
  content: {
    schemaVersion: 1,
    title: 'Dosing',
    language: 'en-GB',
    direction: 'ltr',
    content: [
      {
        type: 'paragraph',
        id: 'b1',
        style: 'body',
        content: [
          {
            type: 'text',
            value: 'Take one',
            marks: [
              { type: 'strong', id: 'm2' },
              { type: 'emphasis', id: 'm1' },
            ],
          },
        ],
      },
    ],
  },
  values: { 'field-study': 'S-1', 'field-sites': ['Leeds', 'York'] },
  notCarried: [{ field: 'field-old', value: 'Ada' }],
  definitions: [
    { kind: 'metadataSchema', id: 'schema-reg', version: '6f1c1a52-0000-4000-8000-000000000002' },
    { kind: 'componentType', id: 'type-protocol', version: '6f1c1a52-0000-4000-8000-000000000001' },
    { kind: 'field', id: 'field-study', version: '6f1c1a52-0000-4000-8000-000000000003' },
  ],
};

describe('the two digests a version records', () => {
  it('hashes the UTF-8 bytes of a string, as 64 lowercase hexadecimal digits', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('takes the version digest over the whole version, and the content hash over content alone', () => {
    const digests = versionDigests(component);
    expect(digests.versionDigest).toBe(sha256Hex(canonicaliseVersion(component)));
    expect(digests.contentHash).toBe(sha256Hex(canonicalise(component.content)));
  });

  it('moves the version digest and not the content hash when only a metadata value changes', () => {
    const before = versionDigests(component);
    const after = versionDigests({
      ...component,
      values: { ...component.values, 'field-study': 'S-2' },
    });
    expect(after.contentHash).toBe(before.contentHash);
    expect(after.versionDigest).not.toBe(before.versionDigest);
  });

  it('digests a definition version by the same rules', () => {
    const field = fieldDefinitionSchema.parse({
      schemaVersion: DEFINITION_SCHEMA_VERSION,
      id: '6f1c1a52-0000-4000-8000-000000000003',
      name: 'Study',
      dataType: 'text',
      multiplicity: 'one',
      validation: {},
    });
    const digests = versionDigests({ kind: 'field', content: field });
    expect(digests.versionDigest).toBe(
      sha256Hex(canonicaliseVersion({ kind: 'field', content: field })),
    );
    expect(digests.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  // Pinned, and never edited: a stored digest is recomputed by anybody holding the row, so this
  // number is what every such recomputation of this version must reach.
  it('digests a known version to exactly these values', () => {
    expect(versionDigests(component)).toEqual({
      contentHash: '7099d261808076077624c5db0484441cc6cca92166cc65e7f061bd12f775a9b4',
      versionDigest: 'aa6b5c84b3f6b71a244e282d99cd95dfedb8d8d7062a83d3d5104d79002ba26a',
    });
  });
});
