import { describe, expect, it } from 'vitest';

import { DEFINITION_SCHEMA_VERSION } from '../metadata/definition.js';
import { fieldDefinitionSchema } from '../metadata/field.js';
import { metadataSchemaDefinitionSchema } from '../metadata/schema.js';
import { OUTLINE_SCHEMA_VERSION, type SectionNode } from '../structure/outline.js';

import { TEMPLATE_SCHEMA_VERSION, templateDefinitionSchema } from './definition.js';
import { materialiseTemplate } from './materialise.js';
import { resolveTemplate } from './resolve.js';

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

const starting = (key: string, words: string, over: object = {}) => ({
  key,
  title: [{ type: 'text', value: words, marks: [] }],
  required: false,
  numbered: true,
  matter: 'body',
  pageBreak: 'none',
  children: [],
  ...over,
});

/** A report: a front-matter summary, then Introduction (with a Scope beneath it) and Results. */
const resolved = () => {
  const definition = templateDefinitionSchema.parse({
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    name: 'Report',
    theme: THEME,
    layout: LAYOUT,
    schemas: [
      { schema: REVIEW, level: 'document', requires: [OWNER] },
      { schema: CHAPTER, level: 'section', requires: [] },
    ],
    outline: {
      sections: [
        starting('summary', 'Summary', { matter: 'front', numbered: false, pageBreak: 'recto' }),
        starting('introduction', 'Introduction', {
          required: true,
          children: [starting('scope', 'Scope')],
        }),
        starting('results', 'Results', { pageBreak: 'page' }),
      ],
    },
    changes: { add: true, remove: true, reorder: true },
  });
  const answer = resolveTemplate(definition, {
    kinds: new Map([
      [THEME, 'theme'],
      [LAYOUT, 'layout'],
      [REVIEW, 'metadataSchema'],
      [CHAPTER, 'metadataSchema'],
    ]),
    schemas: [
      metadataSchemaDefinitionSchema.parse({
        ...identity(REVIEW),
        entries: [
          { field: OWNER, required: false, fixed: false },
          { field: STATUS, required: false, fixed: false, default: 'draft' },
        ],
      }),
      metadataSchemaDefinitionSchema.parse({
        ...identity(CHAPTER),
        entries: [{ field: STATUS, required: true, fixed: false, default: 'outline' }],
      }),
    ],
    fields: [field(OWNER), field(STATUS)],
  });
  if (!answer.ok) throw new Error(JSON.stringify(answer.unresolved));
  return answer;
};

const heading = { title: 'The dosing report', language: 'en-GB', direction: 'ltr' } as const;
/** Identifiers in the shape a node's takes, `aaaa...b`, `aaaa...c` and on, so a test can name them. */
const id = (n: number) => 'a'.repeat(25) + 'bcdefghijklmnopqrstuvwxyz'[n - 1]!;
const counter = () => {
  let next = 0;
  return () => id(++next);
};

describe('a document made from a template', () => {
  it("TPL-012 starts a document with the template's sections, in its order", () => {
    const { outline } = materialiseTemplate(resolved(), heading, counter());
    const words = (node: SectionNode) =>
      node.title.map((inline) => (inline.type === 'text' ? inline.value : '')).join('');
    const tree = (nodes: readonly SectionNode[]): unknown[] =>
      nodes.map((node) => [words(node), tree(node.children as SectionNode[])]);
    expect(tree(outline.nodes as SectionNode[])).toEqual([
      ['Summary', []],
      ['Introduction', [['Scope', []]]],
      ['Results', []],
    ]);
    // Each section takes its starting section's switches as they were declared.
    expect(
      outline.nodes.map(({ matter, numbered, pageBreak }) => [matter, numbered, pageBreak]),
    ).toEqual([
      ['front', false, 'recto'],
      ['body', true, 'none'],
      ['body', true, 'page'],
    ]);
  });

  it('TPL-062 materialises the starting outline and seeds its values', () => {
    const { outline, values } = materialiseTemplate(resolved(), heading, counter());
    // The outline is a document's own, at the current schema, headed as the request asked.
    expect(outline).toMatchObject({ schemaVersion: OUTLINE_SCHEMA_VERSION, ...heading });
    // Every section is a node with an identifier of the document's, and says which key it came from.
    const flat: SectionNode[] = [];
    const walk = (nodes: readonly SectionNode[]) =>
      nodes.forEach((node) => {
        flat.push(node);
        walk(node.children as SectionNode[]);
      });
    walk(outline.nodes as SectionNode[]);
    expect(flat.map((node) => [node.type, node.id, node.origin])).toEqual([
      ['section', id(1), 'summary'],
      ['section', id(2), 'introduction'],
      ['section', id(3), 'scope'],
      ['section', id(4), 'results'],
    ]);
    // Each section's values are seeded from the section level's defaults, and the document's from
    // the document level's: a field with no default is left without a value, required or not.
    for (const node of flat) expect(node.values).toEqual({ [STATUS]: 'outline' });
    expect(values).toEqual({ [STATUS]: 'draft' });
  });

  it("takes nothing of the template's by reference: a document's outline shares no array with it", () => {
    const template = resolved();
    const { outline } = materialiseTemplate(template, heading, counter());
    const introduction = outline.nodes[1] as SectionNode;
    expect(introduction.title).not.toBe(template.outline.sections[1]!.title);
    expect(introduction.title).toEqual(template.outline.sections[1]!.title);
  });
});
