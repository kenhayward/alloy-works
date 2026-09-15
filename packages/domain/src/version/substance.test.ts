import { describe, expect, it } from 'vitest';

import type { ContentDocument } from '../content/model/document.js';
import { DEFINITION_SCHEMA_VERSION } from '../metadata/definition.js';
import { fieldDefinitionSchema } from '../metadata/field.js';
import { canonicalJson } from '../stored/canonical.js';

import {
  canonicaliseVersion,
  canonicaliseVersionContent,
  componentTypeOf,
  type ComponentSubstance,
} from './substance.js';

const TYPE = '6f1c1a52-0000-4000-8000-000000000001';
const SCHEMA = '6f1c1a52-0000-4000-8000-000000000002';
const FIELD = '6f1c1a52-0000-4000-8000-000000000003';

const content: ContentDocument = {
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
};

const component: ComponentSubstance = {
  kind: 'component',
  content,
  values: { 'field-study': 'S-1', 'field-sites': ['Leeds', 'York'] },
  notCarried: [{ field: 'field-old', value: 'Ada' }],
  definitions: [
    { kind: 'metadataSchema', id: 'schema-reg', version: SCHEMA },
    { kind: 'componentType', id: 'type-protocol', version: TYPE },
    { kind: 'field', id: 'field-study', version: FIELD },
  ],
};

describe('the component type a component version records', () => {
  it('is the version of the one component type among its definitions', () => {
    expect(componentTypeOf(component.definitions)).toBe(TYPE);
  });

  it('refuses definitions naming no component type, or two', () => {
    expect(() => componentTypeOf([])).toThrow(/one component type, not 0/);
    expect(() =>
      componentTypeOf([
        { kind: 'componentType', id: 'type-a', version: TYPE },
        { kind: 'componentType', id: 'type-b', version: SCHEMA },
      ]),
    ).toThrow(/one component type, not 2/);
  });
});

describe('the canonical serialisation of a whole version', () => {
  it('is one canonical document: its five members in order, each in its own canonical form', () => {
    const sortedDefinitions = [...component.definitions].sort((a, b) =>
      a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0,
    );
    expect(canonicaliseVersion(component)).toBe(
      canonicalJson({
        componentType: TYPE,
        content: JSON.parse(canonicaliseVersionContent(component)),
        definitions: sortedDefinitions,
        notCarried: component.notCarried,
        values: component.values,
      }),
    );
  });

  it("sorts content's marks as a set and keeps a many value's order, in one serialisation", () => {
    const serialised = canonicaliseVersion(component);
    expect(serialised).toContain(
      '"marks":[{"id":"m1","type":"emphasis"},{"id":"m2","type":"strong"}]',
    );
    expect(serialised).toContain('"field-sites":["Leeds","York"]');

    const underMarks = canonicaliseVersion({ ...component, values: { marks: ['York', 'Leeds'] } });
    expect(underMarks).toContain('"values":{"marks":["York","Leeds"]}');
  });

  it('serialises the definitions as a set, whatever order they were listed in', () => {
    expect(
      canonicaliseVersion({ ...component, definitions: [...component.definitions].reverse() }),
    ).toBe(canonicaliseVersion(component));
  });

  it('orders two definitions of one kind by identifier, whatever order they were listed in', () => {
    const serialised = canonicaliseVersion({
      ...component,
      definitions: [
        { kind: 'componentType', id: 'type-protocol', version: TYPE },
        // Listed in reverse identifier order, and with versions that sort the other way round.
        { kind: 'field', id: 'field-study', version: SCHEMA },
        { kind: 'field', id: 'field-dose', version: FIELD },
        { kind: 'metadataSchema', id: 'schema-reg', version: SCHEMA },
      ],
    });
    expect(serialised).toContain(
      '"definitions":[{"id":"type-protocol","kind":"componentType","version":"' +
        TYPE +
        '"},' +
        '{"id":"field-dose","kind":"field","version":"' +
        FIELD +
        '"},' +
        '{"id":"field-study","kind":"field","version":"' +
        SCHEMA +
        '"},' +
        '{"id":"schema-reg","kind":"metadataSchema","version":"' +
        SCHEMA +
        '"}]',
    );
  });

  it('refuses two versions of one definition, which would record neither honestly', () => {
    expect(() =>
      canonicaliseVersion({
        ...component,
        definitions: [
          ...component.definitions,
          { kind: 'field', id: 'field-study', version: SCHEMA },
        ],
      }),
    ).toThrow(/field field-study is recorded twice/);
  });

  it('changes when only a metadata value changes, and when only what was not carried changes', () => {
    const base = canonicaliseVersion(component);
    expect(
      canonicaliseVersion({ ...component, values: { ...component.values, 'field-study': 'S-2' } }),
    ).not.toBe(base);
    expect(canonicaliseVersion({ ...component, notCarried: [] })).not.toBe(base);
    expect(canonicaliseVersionContent({ ...component, notCarried: [] })).toBe(
      canonicaliseVersionContent(component),
    );
  });

  it('holds a definition version in the same five members, with nothing but its content', () => {
    const field = fieldDefinitionSchema.parse({
      schemaVersion: DEFINITION_SCHEMA_VERSION,
      id: FIELD,
      name: 'Study',
      dataType: 'text',
      multiplicity: 'one',
      validation: {},
    });
    expect(canonicaliseVersion({ kind: 'field', content: field })).toBe(
      `{"componentType":null,"content":${canonicalJson(field)},"definitions":[],"notCarried":[],"values":{}}`,
    );
  });

  // Pinned, and never edited: every stored version digest is SHA-256 over this serialisation, so a
  // change here makes every digest already written unverifiable. A change is a new decision record.
  it('serialises a known version to exactly this string', () => {
    expect(canonicaliseVersion(component)).toBe(
      '{"componentType":"6f1c1a52-0000-4000-8000-000000000001",' +
        '"content":{"content":[{"content":[{"marks":[{"id":"m1","type":"emphasis"},{"id":"m2","type":"strong"}],' +
        '"type":"text","value":"Take one"}],"id":"b1","style":"body","type":"paragraph"}],' +
        '"direction":"ltr","language":"en-GB","schemaVersion":1,"title":"Dosing"},' +
        '"definitions":[{"id":"type-protocol","kind":"componentType","version":"6f1c1a52-0000-4000-8000-000000000001"},' +
        '{"id":"field-study","kind":"field","version":"6f1c1a52-0000-4000-8000-000000000003"},' +
        '{"id":"schema-reg","kind":"metadataSchema","version":"6f1c1a52-0000-4000-8000-000000000002"}],' +
        '"notCarried":[{"field":"field-old","value":"Ada"}],' +
        '"values":{"field-sites":["Leeds","York"],"field-study":"S-1"}}',
    );
  });
});
