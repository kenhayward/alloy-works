import { describe, expect, it } from 'vitest';

import { DEFINITION_SCHEMA_VERSION } from '../metadata/definition.js';
import { fieldDefinitionSchema } from '../metadata/field.js';
import type { EffectiveField } from '../metadata/resolve.js';
import { OUTLINE_SCHEMA_VERSION, parseOutlineDocument } from '../structure/outline.js';

import { missingSections, valueFailures } from './conformance.js';
import { TEMPLATE_SCHEMA_VERSION, templateDefinitionSchema } from './definition.js';

const THEME = '4ae73bd5-0000-4000-8000-000000002866';
const LAYOUT = '1a7e0a2b-0000-4000-8000-00000000f501';
const id = (n: number) => 'a'.repeat(25) + 'bcdefghijklmnopqrstuvwxyz'[n - 1]!;
const text = (value: string) => [{ type: 'text', value, marks: [] }];

const starting = (key: string, words: string, required: boolean, children: object[] = []) => ({
  key,
  title: text(words),
  required,
  numbered: true,
  matter: 'body',
  pageBreak: 'none',
  children,
});
const definition = templateDefinitionSchema.parse({
  schemaVersion: TEMPLATE_SCHEMA_VERSION,
  name: 'Report',
  theme: THEME,
  layout: LAYOUT,
  schemas: [],
  outline: {
    sections: [
      starting('introduction', 'Introduction', true, [starting('scope', 'Scope', true)]),
      starting('method', 'Method', false),
      starting('conclusion', 'Conclusion', true),
    ],
  },
  changes: { add: true, remove: true, reorder: true },
});

const section = (
  n: number,
  words: string,
  origin?: string,
  children: object[] = [],
  values = {},
) => ({
  type: 'section',
  id: id(n),
  title: text(words),
  ...(origin === undefined ? {} : { origin }),
  numbered: true,
  matter: 'body',
  pageBreak: 'none',
  values,
  children,
});
const outline = (nodes: object[]) =>
  parseOutlineDocument({
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: 'The dosing report',
    language: 'en-GB',
    direction: 'ltr',
    nodes,
  });

describe("a document against its template's requirements", () => {
  it('names each required starting section no section came from, at any depth, by its title', () => {
    // Scope was removed, and Conclusion's section retitled and moved under Method: found by its key.
    const shaped = outline([
      section(1, 'Introduction', 'introduction'),
      section(2, 'Method', 'method', [section(3, 'Findings', 'conclusion')]),
      section(4, 'Scope', undefined),
    ]);
    // A section the author titled Scope is not the starting Scope: only its key says where it came from.
    expect(missingSections(definition, shaped)).toEqual([{ key: 'scope', title: 'Scope' }]);
    expect(
      missingSections(
        definition,
        outline([
          section(1, 'Introduction', 'introduction', [section(2, 'Scope', 'scope')]),
          section(3, 'Conclusion', 'conclusion'),
        ]),
      ),
    ).toEqual([]);
  });

  it("checks the document's values and every section's, naming the node each failure belongs to", () => {
    const field = (fieldId: string, name: string) =>
      fieldDefinitionSchema.parse({
        schemaVersion: DEFINITION_SCHEMA_VERSION,
        id: fieldId,
        name,
        dataType: 'text',
        multiplicity: 'one',
        validation: { maxLength: 4 },
      });
    const required = (fieldId: string, name: string): EffectiveField => ({
      field: field(fieldId, name),
      required: true,
      requiredBy: ['schema-review'],
      fixed: false,
      fixedBy: [],
    });
    const shaped = outline([
      section(1, 'Introduction', 'introduction', [], { 'field-code': 'I1' }),
      section(2, 'Method', 'method', [], { 'field-code': 'M12345' }),
      section(3, 'Results', undefined),
    ]);
    const failures = valueFailures(
      { document: [required('field-owner', 'Owner')], section: [required('field-code', 'Code')] },
      shaped,
      {},
    );
    expect(failures.map(({ node, field, rule }) => [node, field, rule])).toEqual([
      [null, 'field-owner', 'required'],
      [id(2), 'field-code', 'maxLength'],
      [id(3), 'field-code', 'required'],
    ]);
  });
});
