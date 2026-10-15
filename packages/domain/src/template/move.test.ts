import { describe, expect, it } from 'vitest';

import { DEFINITION_SCHEMA_VERSION } from '../metadata/definition.js';
import { fieldDefinitionSchema } from '../metadata/field.js';
import type { EffectiveField } from '../metadata/resolve.js';
import { OUTLINE_SCHEMA_VERSION, parseOutlineDocument } from '../structure/outline.js';

import { TEMPLATE_SCHEMA_VERSION, templateDefinitionSchema } from './definition.js';
import { planTemplateMove } from './move.js';

const THEME = '4ae73bd5-0000-4000-8000-000000002866';
const NEWER_THEME = '4ae73bd5-0000-4000-8000-000000002867';
const LAYOUT = '1a7e0a2b-0000-4000-8000-00000000f501';
const OWNER = '6b1f0000-0000-4000-8000-000000000001';
const REVIEWER = '6b1f0000-0000-4000-8000-000000000002';
const STAGE = '6b1f0000-0000-4000-8000-000000000003';
const id = (n: number) => 'a'.repeat(25) + 'bcdefghijklmnopqrstuvwxyz'[n - 1]!;
const text = (value: string) => [{ type: 'text', value, marks: [] }];

const starting = (key: string, words: string, required: boolean) => ({
  key,
  title: text(words),
  required,
  numbered: true,
  matter: 'body',
  pageBreak: 'none',
  children: [],
});
const template = (theme: string, sections: object[]) =>
  templateDefinitionSchema.parse({
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    name: 'Report',
    theme,
    layout: LAYOUT,
    schemas: [],
    outline: { sections },
    changes: { add: true, remove: true, reorder: true },
  });
const field = (fieldId: string, name: string, required = false): EffectiveField => ({
  field: fieldDefinitionSchema.parse({
    schemaVersion: DEFINITION_SCHEMA_VERSION,
    id: fieldId,
    name,
    dataType: 'text',
    multiplicity: 'one',
    validation: {},
  }),
  required,
  requiredBy: [],
  fixed: false,
  fixedBy: [],
});
const outline = parseOutlineDocument({
  schemaVersion: OUTLINE_SCHEMA_VERSION,
  title: 'The dosing report',
  language: 'en-GB',
  direction: 'ltr',
  nodes: [
    {
      type: 'section',
      id: id(1),
      title: text('Introduction'),
      origin: 'introduction',
      numbered: true,
      matter: 'body',
      pageBreak: 'none',
      values: { [STAGE]: 'Draft' },
      children: [],
    },
  ],
});

describe('moving a document to a newer template version (templates.md; the WF6 plan, WF6-D)', () => {
  it('TPL-034 TPL-058 reports the theme, each field that changes, each value not carried and each section now required, carrying the rest forward', () => {
    const plan = planTemplateMove({
      from: {
        definition: template(THEME, [starting('introduction', 'Introduction', true)]),
        document: [field(OWNER, 'Owner'), field(REVIEWER, 'Reviewer')],
        section: [field(STAGE, 'Stage')],
      },
      to: {
        definition: template(NEWER_THEME, [
          starting('introduction', 'Introduction', true),
          starting('method', 'Method', true),
        ]),
        document: [field(OWNER, 'Owner', true)],
        section: [],
      },
      outline,
      values: { [OWNER]: 'Ada', [REVIEWER]: 'Grace' },
      waived: new Set(),
    });
    expect(plan.report).toEqual({
      theme: { from: THEME, to: NEWER_THEME },
      layout: null,
      fields: [
        { level: 'document', field: OWNER, name: 'Owner', change: 'required' },
        { level: 'document', field: REVIEWER, name: 'Reviewer', change: 'removed' },
        { level: 'section', field: STAGE, name: 'Stage', change: 'removed' },
      ],
      notCarried: [
        { node: null, field: REVIEWER, name: 'Reviewer', value: 'Grace' },
        { node: id(1), field: STAGE, name: 'Stage', value: 'Draft' },
      ],
      missing: [{ key: 'method', title: 'Method' }],
    });
    expect(plan.values).toEqual({ [OWNER]: 'Ada' });
    expect(plan.outline.nodes[0]!.values).toEqual({});
  });

  it('reports nothing where the newer version changes nothing the document holds', () => {
    const same = {
      definition: template(THEME, [starting('introduction', 'Introduction', true)]),
      document: [field(OWNER, 'Owner')],
      section: [field(STAGE, 'Stage')],
    };
    const plan = planTemplateMove({
      from: same,
      to: same,
      outline,
      values: { [OWNER]: 'Ada' },
      waived: new Set(),
    });
    expect(plan.report).toEqual({
      theme: null,
      layout: null,
      fields: [],
      notCarried: [],
      missing: [],
    });
    expect(plan.values).toEqual({ [OWNER]: 'Ada' });
  });
});
