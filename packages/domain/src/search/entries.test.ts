import { describe, expect, it } from 'vitest';

import { MATHML_NAMESPACE } from '../content/admission/mathml.js';
import { parseContentDocument } from '../content/model/document.js';
import { parseOutlineDocument } from '../structure/outline.js';
import { templateDefinitionSchema } from '../template/definition.js';
import { parseAssetVersion } from '../assets/version.js';
import type { QueryDefinition } from '../data/definition.js';
import {
  componentTypeDefinitionSchema,
  fieldDefinitionSchema,
  metadataSchemaDefinitionSchema,
} from '../metadata/index.js';
import {
  configurationFor,
  entriesOf,
  SEARCH_CONFIGURATIONS,
  type SearchContext,
  type SearchEntryDraft,
} from './entries.js';

const REVIEWER = '10000000-0000-4000-8000-000000000001';
const APPROVED = '10000000-0000-4000-8000-000000000002';
const DUE = '10000000-0000-4000-8000-000000000003';
const OWNER = '10000000-0000-4000-8000-000000000004';
const SIGN_OFF = '10000000-0000-4000-8000-000000000005';
const ADA = '20000000-0000-4000-8000-000000000001';
const INTRO = 'a'.repeat(26);
const SCOPE = 'b'.repeat(26);
const ASSET_VERSION = '30000000-0000-4000-8000-000000000001';
const CONNECTION = '40000000-0000-4000-8000-000000000001';

const context: SearchContext = {
  fields: new Map([
    [REVIEWER, { name: 'Reviewer', dataType: 'text' }],
    [APPROVED, { name: 'Approved', dataType: 'boolean' }],
    [DUE, { name: 'Due date', dataType: 'date' }],
    [OWNER, { name: 'Owner', dataType: 'user' }],
  ]),
  schemas: new Map([[SIGN_OFF, 'Sign-off']]),
  people: new Map([[ADA, 'Ada Lovelace']]),
};

const text = (value: string) => ({ type: 'text', value, marks: [] });
const para = (id: string, ...content: unknown[]) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content,
});
const math = `<math xmlns="${MATHML_NAMESPACE}" alttext="x equals two"><mi>x</mi><mo>=</mo><mn>2</mn></math>`;

/** Every text row of an entry, by place. */
const places = (entry: SearchEntryDraft) =>
  Object.fromEntries(entry.texts.map((each) => [each.place, each.text]));

describe('what search reads from a version', () => {
  it('SCH-002 covers content, metadata, titles, captions and alternative text', () => {
    const content = parseContentDocument({
      schemaVersion: 1,
      title: 'Calibrating the scanner',
      language: 'en-GB',
      direction: 'ltr',
      content: [
        para(
          'p1',
          text('Hold the lever'),
          {
            type: 'footnote',
            id: 'fn1',
            anchor: { kind: 'span' },
            content: [para('fp1', text('Firmly, with both hands'))],
          },
          text(' until it clicks.'),
        ),
        {
          type: 'figure',
          id: 'f1',
          asset: ASSET_VERSION,
          imageStyle: 'figure',
          caption: [text('The lever at rest')],
          alternative: { kind: 'own', text: 'A red lever beside a dial' },
        },
        {
          type: 'table',
          id: 't1',
          style: 'table',
          caption: [text('Tolerances')],
          headerRows: 1,
          headerColumns: 0,
          rows: [
            { cells: [{ content: [para('c1', text('Gauge'))], colspan: 1, rowspan: 1 }] },
            {
              cells: [
                { content: [para('c2', text('Twelve millimetres'))], colspan: 1, rowspan: 1 },
              ],
            },
          ],
        },
        para('p2', { type: 'equation', mathml: math }),
      ],
    });
    const [entry, ...more] = entriesOf(
      {
        kind: 'component',
        content,
        values: {
          [REVIEWER]: 'Grace',
          [APPROVED]: true,
          [DUE]: '2026-10-01',
          [OWNER]: { user: ADA },
        },
      },
      context,
    );

    expect(more).toEqual([]);
    expect(entry).toMatchObject({
      kind: 'component',
      node: null,
      title: 'Calibrating the scanner',
    });
    expect(places(entry!)).toEqual({
      // Its title.
      title: 'Calibrating the scanner',
      // Its content, a footnote and a cell's paragraphs as blocks of their own, and an equation by
      // the words it is spoken by.
      'block:p1': 'Hold the lever until it clicks.',
      'block:fp1': 'Firmly, with both hands',
      'block:c1': 'Gauge',
      'block:c2': 'Twelve millimetres',
      'block:p2': 'x equals two',
      // A caption, and alternative text.
      'block:f1': 'The lever at rest A red lever beside a dial',
      'block:t1': 'Tolerances',
      // Its metadata, each field a place of its own: a person by name, a boolean by its field's name.
      [`field:${REVIEWER}`]: 'Grace',
      [`field:${APPROVED}`]: 'Approved',
      [`field:${DUE}`]: '2026-10-01',
      [`field:${OWNER}`]: 'Ada Lovelace',
    });
  });

  it("reads a bound table by its caption, headers, empty statement, note and source, and its source's footnote as a block", () => {
    const content = parseContentDocument({
      schemaVersion: 1,
      title: 'Readings',
      language: 'en-GB',
      direction: 'ltr',
      content: [
        {
          type: 'boundTable',
          id: 't1',
          binding: {
            type: 'binding',
            id: 'k1',
            query: '00000000-0000-4000-8000-00000000d001',
            parameters: {},
            mode: 'checked',
          },
          caption: [text('Depths by site')],
          columns: [
            { column: 'site', header: 'Site' },
            { column: 'depth', header: 'Depth' },
          ],
          headerColumn: true,
          empty: [text('No readings')],
          note: [text('At noon')],
          source: [
            text('The survey'),
            {
              type: 'footnote',
              id: 'fn1',
              anchor: { kind: 'span' },
              content: [para('fp1', text('Taken in spring'))],
            },
          ],
        },
      ],
    });
    const [entry] = entriesOf({ kind: 'component', content, values: {} }, context);
    expect(places(entry!)).toEqual({
      title: 'Readings',
      'block:t1': 'Depths by site Site Depth No readings At noon The survey',
      'block:fp1': 'Taken in spring',
    });
  });

  it("makes a document an entry and each of its sections one of its own, in the document's language", () => {
    const outline = parseOutlineDocument({
      schemaVersion: 3,
      title: 'Scanner manual',
      language: 'fr',
      direction: 'ltr',
      nodes: [
        {
          type: 'section',
          id: INTRO,
          title: [text('Introduction')],
          numbered: true,
          matter: 'body',
          pageBreak: 'none',
          values: { [REVIEWER]: 'Grace' },
          children: [
            {
              type: 'section',
              id: SCOPE,
              title: [text('Scope')],
              numbered: true,
              matter: 'body',
              pageBreak: 'none',
              values: {},
              children: [],
            },
          ],
        },
      ],
    });
    const entries = entriesOf(
      { kind: 'document', content: outline, values: { [APPROVED]: false } },
      context,
    );

    expect(entries.map((each) => [each.kind, each.node, each.title, each.configuration])).toEqual([
      ['document', null, 'Scanner manual', 'french'],
      ['section', INTRO, 'Introduction', 'french'],
      ['section', SCOPE, 'Scope', 'french'],
    ]);
    // A false boolean says nothing, so it is no place to match.
    expect(places(entries[0]!)).toEqual({ title: 'Scanner manual' });
    expect(places(entries[1]!)).toEqual({ title: 'Introduction', [`field:${REVIEWER}`]: 'Grace' });
    expect(entries[1]!.values).toEqual({ [REVIEWER]: 'Grace' });
  });

  it('reads a publication, a template, an asset and each kind of definition', () => {
    const template = templateDefinitionSchema.parse({
      schemaVersion: 1,
      name: 'Procedure manual',
      theme: '40000000-0000-4000-8000-000000000001',
      layout: '40000000-0000-4000-8000-000000000002',
      schemas: [],
      outline: {
        sections: [
          {
            key: 'safety',
            title: [text('Safety')],
            required: true,
            numbered: true,
            matter: 'body',
            pageBreak: 'none',
            children: [],
          },
        ],
      },
      changes: { add: true, remove: true, reorder: true },
    });
    const asset = parseAssetVersion({
      schemaVersion: 1,
      object: `t_acme/sha256/${'a'.repeat(64)}`,
      format: 'png',
      bytes: 10,
      width: 1,
      height: 1,
      orientation: 1,
      colour: 'rgb',
      alpha: false,
      depth: 8,
      resolution: null,
      alternative: { text: 'A scanner seen from above', language: 'de' },
    });
    const field = fieldDefinitionSchema.parse({
      schemaVersion: 1,
      id: DUE,
      name: 'Due date',
      dataType: 'date',
      multiplicity: 'one',
      validation: {},
    });
    const schema = metadataSchemaDefinitionSchema.parse({
      schemaVersion: 1,
      id: SIGN_OFF,
      name: 'Sign-off',
      entries: [
        { field: OWNER, required: true, fixed: false },
        { field: DUE, required: false, fixed: false },
      ],
    });
    const type = componentTypeDefinitionSchema.parse({
      schemaVersion: 1,
      id: '10000000-0000-4000-8000-000000000009',
      name: 'Procedure',
      assignments: [{ schema: SIGN_OFF, requires: [] }],
    });

    const read = (source: Parameters<typeof entriesOf>[0]) => {
      const [entry] = entriesOf(source, context);
      return [entry!.kind, entry!.title, entry!.configuration, places(entry!)];
    };
    expect(
      read({ kind: 'publication', title: 'Scanner manual', version: '0.3', language: 'en' }),
    ).toEqual(['publication', 'Scanner manual', 'english', { title: 'Scanner manual 0.3' }]);
    expect(read({ kind: 'template', content: template })).toEqual([
      'template',
      'Procedure manual',
      'simple',
      { title: 'Procedure manual', 'section:safety': 'Safety' },
    ]);
    expect(read({ kind: 'asset', content: asset })).toEqual([
      'asset',
      'A scanner seen from above',
      'german',
      { description: 'A scanner seen from above' },
    ]);
    expect(read({ kind: 'field', content: field })).toEqual([
      'field',
      'Due date',
      'simple',
      { title: 'Due date' },
    ]);
    expect(read({ kind: 'metadataSchema', content: schema })).toEqual([
      'metadataSchema',
      'Sign-off',
      'simple',
      { title: 'Sign-off', fields: 'Owner Due date' },
    ]);
    expect(read({ kind: 'componentType', content: type })).toEqual([
      'componentType',
      'Procedure',
      'simple',
      { title: 'Procedure', schemas: 'Sign-off' },
    ]);
  });

  it("reads a query definition by its title, its description and its columns' names, and never its SQL or its connection", () => {
    const definition: QueryDefinition = {
      schemaVersion: 1,
      title: 'Readings by site',
      description: 'Each reading at a site.',
      connection: CONNECTION,
      parameters: [{ name: 'site', type: { base: 'integer' }, required: true, list: false }],
      fetch: { kind: 'sql', text: 'select id, taken from sample.reading where site = {{site}}' },
      columns: [
        { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
        { name: 'Taken at', from: { column: 'taken' }, type: { base: 'instant', fraction: 3 } },
      ],
      key: ['id'],
      order: [{ column: 'id', direction: 'ascending' }],
      empty: 'valid',
      limits: { rows: 10, bytes: 1000, seconds: 5 },
      retired: false,
    };
    const read = (source: Parameters<typeof entriesOf>[0]) => {
      const [entry] = entriesOf(source, context);
      return [entry!.kind, entry!.title, entry!.configuration, places(entry!)];
    };
    expect(read({ kind: 'queryDefinition', content: definition })).toEqual([
      'queryDefinition',
      'Readings by site',
      'simple',
      {
        title: 'Readings by site',
        description: 'Each reading at a site.',
        columns: 'id Taken at',
      },
    ]);
    // An empty description is no place.
    const [entry] = entriesOf(
      { kind: 'queryDefinition', content: { ...definition, description: '' } },
      context,
    );
    expect(places(entry!)).toEqual({ title: 'Readings by site', columns: 'id Taken at' });
    expect(JSON.stringify(entry)).not.toContain('sample.reading');
    expect(JSON.stringify(entry)).not.toContain(CONNECTION);
  });

  it('composes what it reads, so two spellings a reader cannot tell apart are one', () => {
    const decomposed = 'Café';
    const [entry] = entriesOf(
      { kind: 'publication', title: decomposed, version: '0.1', language: 'en' },
      context,
    );
    expect(entry!.title).toBe('Café');
    expect(places(entry!)).toEqual({ title: 'Café 0.1' });
  });

  it('maps a language to the configuration Postgres ships for it, and anything else to simple', () => {
    expect(configurationFor('en-GB')).toBe('english');
    expect(configurationFor('pt-BR')).toBe('portuguese');
    expect(configurationFor('nb')).toBe('norwegian');
    expect(configurationFor('ja')).toBe('simple');
    expect(configurationFor(null)).toBe('simple');
    expect(SEARCH_CONFIGURATIONS).toContain('simple');
  });
});
