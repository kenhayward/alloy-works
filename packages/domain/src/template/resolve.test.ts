import { describe, expect, it } from 'vitest';

import { DEFINITION_SCHEMA_VERSION } from '../metadata/definition.js';
import { fieldDefinitionSchema } from '../metadata/field.js';
import { metadataSchemaDefinitionSchema } from '../metadata/schema.js';

import { TEMPLATE_SCHEMA_VERSION, templateDefinitionSchema } from './definition.js';
import { resolveTemplate, type TemplateReferences } from './resolve.js';

const THEME = '4ae73bd5-0000-4000-8000-000000002866';
const LAYOUT = '1a7e0a2b-0000-4000-8000-00000000f501';
const REVIEW = '5c4e0000-0000-4000-8000-000000000001';
const CHAPTER = '5c4e0000-0000-4000-8000-000000000002';
const OWNER = 'f1e1d000-0000-4000-8000-000000000001';
const STATUS = 'f1e1d000-0000-4000-8000-000000000002';

const identity = (id: string) => ({ schemaVersion: DEFINITION_SCHEMA_VERSION, id, name: id });
const field = (id: string) =>
  fieldDefinitionSchema.parse({
    ...identity(id),
    dataType: 'text',
    multiplicity: 'one',
    validation: {},
  });
const schema = (id: string, entries: object[]) =>
  metadataSchemaDefinitionSchema.parse({ ...identity(id), entries });

const template = (schemas: object[], sections = [{ key: 'introduction', words: 'Introduction' }]) =>
  templateDefinitionSchema.parse({
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    name: 'Report',
    theme: THEME,
    layout: LAYOUT,
    schemas,
    outline: {
      sections: sections.map(({ key, words }) => ({
        key,
        title: [{ type: 'text', value: words, marks: [] }],
        required: false,
        numbered: true,
        matter: 'body',
        pageBreak: 'none',
        children: [],
      })),
    },
    changes: { add: true, remove: true, reorder: true },
  });

/** What the service found: the one theme and layout, the review and chapter schemas, their fields. */
const found = (over: Partial<TemplateReferences> = {}): TemplateReferences => ({
  kinds: new Map([
    [THEME, 'theme'],
    [LAYOUT, 'layout'],
    [REVIEW, 'metadataSchema'],
    [CHAPTER, 'metadataSchema'],
  ]),
  schemas: [
    schema(REVIEW, [
      { field: OWNER, required: false, fixed: false },
      { field: STATUS, required: false, fixed: false, default: 'draft' },
    ]),
    schema(CHAPTER, [{ field: STATUS, required: true, fixed: false }]),
  ],
  fields: [field(OWNER), field(STATUS)],
  ...over,
});

describe('resolving a template', () => {
  it('TPL-053 owns its outline and references its theme, layout and schemas, resolved where used', () => {
    const definition = template(
      [
        { schema: REVIEW, level: 'document', requires: [OWNER] },
        { schema: CHAPTER, level: 'section', requires: [] },
      ],
      [
        { key: 'introduction', words: 'Introduction' },
        { key: 'results', words: 'Results' },
      ],
    );
    const resolved = resolveTemplate(definition, found());
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.unresolved));
    // The outline is the template's own, read from the definition and nothing else.
    expect(resolved.outline.sections.map((each) => each.key)).toEqual(['introduction', 'results']);
    // The theme and layout are named, not copied: what is answered is the identifier bound.
    expect(resolved.theme).toBe(THEME);
    expect(resolved.layout).toBe(LAYOUT);
    // And each schema is resolved against the definitions found now, at its level: the document's
    // owner made required by the assignment, its status defaulted; a section's status required.
    expect(
      resolved.document.map((each) => [each.field.id, each.required, each.default?.value ?? null]),
    ).toEqual([
      [OWNER, true, null],
      [STATUS, false, 'draft'],
    ]);
    expect(resolved.section.map((each) => [each.field.id, each.required])).toEqual([
      [STATUS, true],
    ]);
  });

  it('names every reference that does not resolve, and resolves nothing then', () => {
    const MISSING = '00000000-0000-4000-8000-00000000dead';
    const definition = {
      ...template([
        { schema: REVIEW, level: 'document', requires: ['not-grouped'] },
        { schema: MISSING, level: 'section', requires: [] },
      ]),
      theme: LAYOUT,
      layout: MISSING,
    };
    const resolved = resolveTemplate(definition, found());
    expect(resolved).toEqual({
      ok: false,
      unresolved: [
        { reference: 'theme', id: LAYOUT },
        { reference: 'layout', id: MISSING },
        { reference: 'requires', id: REVIEW, field: 'not-grouped' },
        { reference: 'schema', id: MISSING },
      ],
    });
  });

  it('names two schemas at one level whose defaults disagree, rather than choosing one', () => {
    const definition = template([
      { schema: REVIEW, level: 'document', requires: [] },
      { schema: CHAPTER, level: 'document', requires: [] },
    ]);
    const disagreeing = found({
      schemas: [
        schema(REVIEW, [{ field: STATUS, required: false, fixed: false, default: 'draft' }]),
        schema(CHAPTER, [{ field: STATUS, required: false, fixed: false, default: 'final' }]),
      ],
    });
    const resolved = resolveTemplate(definition, disagreeing);
    expect(resolved.ok).toBe(false);
    expect(!resolved.ok && resolved.unresolved).toEqual([
      { reference: 'conflict', id: STATUS, level: 'document', schemas: [REVIEW, CHAPTER] },
    ]);
  });
});
