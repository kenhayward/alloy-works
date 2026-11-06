import { describe, expect, it } from 'vitest';

import { OUTLINE_SCHEMA_VERSION, parseOutlineDocument } from '../structure/outline.js';

import { blankTemplate, BLANK_WORDS } from './blank.js';
import { missingComponents, requiredKeys } from './conformance.js';
import { instantiateOf, TEMPLATE_SCHEMA_VERSION, templateDefinitionSchema } from './definition.js';
import { materialiseTemplate } from './materialise.js';
import { planTemplateMove } from './move.js';
import { resolveTemplate, type TemplateReferences } from './resolve.js';
import { templateSummary } from './summary.js';

const THEME = '4ae73bd5-0000-4000-8000-000000002866';
const LAYOUT = '1a7e0a2b-0000-4000-8000-00000000f501';
const METHOD = 'c0c0c0c0-0000-4000-8000-000000000001';
const NOTICE = 'c0c0c0c0-0000-4000-8000-000000000002';
const METHOD_V3 = 'c0c0c0c0-0000-4000-8000-0000000000a3';
const COPY = 'c0c0c0c0-0000-4000-8000-0000000000c1';
const OTHER_COPY = 'c0c0c0c0-0000-4000-8000-0000000000c2';

const text = (value: string) => [{ type: 'text', value, marks: [] }];
const starting = (key: string, words: string, over: object = {}) => ({
  key,
  title: text(words),
  required: false,
  numbered: true,
  matter: 'body',
  pageBreak: 'none',
  children: [],
  ...over,
});
const paragraph = (value: string) => ({
  type: 'paragraph',
  id: 'p'.repeat(26),
  style: 'body',
  content: text(value),
});

const definition = (over: object) =>
  templateDefinitionSchema.safeParse({
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    name: 'Survey report',
    theme: THEME,
    layout: LAYOUT,
    schemas: [],
    outline: {
      sections: [
        starting('method', 'Method', {
          instantiate: 'copy',
          children: [starting('detail', 'Detail')],
        }),
        starting('annex', 'Annex'),
      ],
    },
    changes: { add: true, remove: true, reorder: true },
    ...over,
  });

const found = (over: Partial<TemplateReferences> = {}): TemplateReferences => ({
  kinds: new Map([
    [THEME, 'theme'],
    [LAYOUT, 'layout'],
  ]),
  schemas: [],
  fields: [],
  components: new Map([
    ['statement', { state: 'found', version: METHOD_V3, bindings: [] }],
    ['notice', { state: 'found', version: NOTICE, bindings: [] }],
  ]),
  definitions: new Set(),
  ...over,
});

const identifiers = (prefix = 'a') => {
  let n = 0;
  return () => prefix.repeat(25) + 'bcdefghijklmnopqrstuvwxyz'[(n += 1) - 1]!;
};

describe('a template places a component by reference or as a copy (the ND plan, ND-C, ND-F, ND-G)', () => {
  it('TPL-075 names a component or holds content, exactly one, and content is always copied', () => {
    const inline = { key: 'intro', content: { title: 'Intro', blocks: [paragraph('Words.')] } };
    const place = { section: null, at: 'start' };
    expect(definition({ components: [{ ...inline, place }] }).success).toBe(true);
    expect(definition({ components: [{ key: 'x', place }] }).success).toBe(false);
    expect(definition({ components: [{ ...inline, component: METHOD, place }] }).success).toBe(
      false,
    );
    expect(
      definition({ components: [{ ...inline, instantiate: 'reference', place }] }).success,
    ).toBe(false);
    // Content is a component's: a title and at least one block.
    expect(
      definition({
        components: [{ key: 'x', content: { title: ' ', blocks: [paragraph('a')] }, place }],
      }).success,
    ).toBe(false);
    expect(
      definition({ components: [{ key: 'x', content: { title: 'T', blocks: [] }, place }] })
        .success,
    ).toBe(false);
    // Checked as a component's content is, so creation never meets words it cannot store.
    expect(
      definition({
        components: [
          { key: 'x', content: { title: 'T', blocks: [paragraph('a'), paragraph('b')] }, place },
        ],
      }).success,
    ).toBe(false);
  });

  it('TPL-075 places by reference unless declared, a starting section setting the default for those under it', () => {
    const parsed = definition({
      components: [
        { key: 'top', component: METHOD, place: { section: null, at: 'start' } },
        { key: 'inherited', component: METHOD, place: { section: 'detail', at: 'end' } },
        {
          key: 'declared',
          component: NOTICE,
          instantiate: 'reference',
          place: { section: 'method', at: 'end' },
        },
        { key: 'annexed', component: NOTICE, place: { section: 'annex', at: 'end' } },
      ],
    }).data!;
    expect(parsed.components!.map((each) => instantiateOf(parsed, each))).toEqual([
      'reference',
      'copy',
      'reference',
      'reference',
    ]);
  });

  it('TPL-075 places a copy as the document own component, following its latest, carrying its key', () => {
    const parsed = definition({
      components: [
        { key: 'statement', component: METHOD, place: { section: 'method', at: 'start' } },
        {
          key: 'notice',
          content: { title: 'Notice', blocks: [paragraph('Read this.')] },
          place: { section: null, at: 'end' },
        },
      ],
    }).data!;
    // Content needs nothing found; a copied component is found at its latest.
    const answer = resolveTemplate(
      parsed,
      found({ components: new Map([['statement', found().components!.get('statement')!]]) }),
    );
    if (!answer.ok) throw new Error(JSON.stringify(answer.unresolved));
    expect(answer.components.map((each) => [each.key, each.instantiate, each.version])).toEqual([
      ['statement', 'copy', METHOD_V3],
      ['notice', 'copy', null],
    ]);
    const { outline } = materialiseTemplate(
      answer,
      { title: 'Site 4', language: 'en-GB', direction: 'ltr' },
      identifiers(),
      new Map([
        ['statement', COPY],
        ['notice', OTHER_COPY],
      ]),
    );
    expect(outline.nodes[0]!.children[0]).toMatchObject({
      type: 'reference',
      component: COPY,
      origin: 'statement',
      mode: { kind: 'latest' },
    });
    expect(outline.nodes.at(-1)).toMatchObject({ component: OTHER_COPY, origin: 'notice' });
  });

  it('TPL-075 guards a required copy as required, and leaves one not required to the author', () => {
    const parsed = definition({
      components: [
        { key: 'statement', component: METHOD, place: { section: 'method', at: 'start' } },
        {
          key: 'notice',
          required: false,
          content: { title: 'Notice', blocks: [paragraph('Read this.')] },
          place: { section: null, at: 'end' },
        },
      ],
    }).data!;
    expect(requiredKeys(parsed)).toEqual(['statement']);
    const empty = parseOutlineDocument({
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      title: 'Site 4',
      language: 'en-GB',
      direction: 'ltr',
      nodes: [],
    });
    expect(missingComponents(parsed, empty)).toEqual([{ key: 'statement', component: METHOD }]);
  });

  it('TPL-075 never adds a copy on a move: a copied component new to the version is reported missing instead', () => {
    const from = { definition: definition({}).data!, document: [], section: [] };
    const to = {
      ...from,
      definition: definition({
        components: [
          { key: 'statement', component: METHOD, place: { section: 'method', at: 'start' } },
          { key: 'notice', component: NOTICE, place: { section: 'annex', at: 'end' } },
          {
            key: 'optional',
            component: NOTICE,
            required: false,
            place: { section: 'annex', at: 'start' },
          },
        ],
      }).data!,
    };
    const outline = materialiseTemplate(
      resolveTemplate(from.definition, found()) as Extract<
        ReturnType<typeof resolveTemplate>,
        { ok: true }
      >,
      { title: 'Site 4', language: 'en-GB', direction: 'ltr' },
      identifiers(),
    ).outline;
    const plan = planTemplateMove({
      from,
      to,
      outline,
      values: {},
      waived: new Set(),
      newIdentifier: identifiers('m'),
    });
    expect(plan.report.adding).toEqual([{ kind: 'component', key: 'notice', title: 'notice' }]);
    expect(missingComponents(to.definition, plan.outline)).toEqual([
      { key: 'statement', component: METHOD },
    ]);
  });
});

describe('a template described, and its values labelled (the ND plan, ND-D)', () => {
  it('TPL-076 carries a description and a label for each value, each optional and bounded', () => {
    const parameter = {
      name: 'site',
      type: { base: 'text' },
      required: true,
      list: false,
      changeable: false,
      feeds: { arguments: false },
    };
    const parsed = definition({
      description: 'For a survey of one site.',
      parameters: [{ ...parameter, label: 'Site name' }],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data!.description).toBe('For a survey of one site.');
    expect(parsed.data!.parameters![0]!.label).toBe('Site name');
    expect(definition({ parameters: [{ ...parameter }] }).success).toBe(true);
    expect(definition({ parameters: [{ ...parameter, label: ' ' }] }).success).toBe(false);
    expect(definition({ parameters: [{ ...parameter, label: 'x'.repeat(201) }] }).success).toBe(
      false,
    );
    expect(definition({ description: 'x'.repeat(1001) }).success).toBe(false);
  });
});

describe('Blank, and a template summarised (the ND plan, ND-F, ND-H)', () => {
  it('TPL-074 makes Blank: no sections, and one copied component, not required, asking for a title and text', () => {
    const blank = blankTemplate(BLANK_WORDS, THEME, LAYOUT);
    expect(templateDefinitionSchema.safeParse(blank).success).toBe(true);
    expect(blank.name).toBe('Blank');
    expect(blank.outline.sections).toEqual([]);
    expect(blank.components).toHaveLength(1);
    const [only] = blank.components!;
    expect(instantiateOf(blank, only!)).toBe('copy');
    expect(only!.required).toBe(false);
    expect(only!.content!.title).toBe('Please supply a title');
    expect(JSON.stringify(only!.content!.blocks)).toContain('Please supply the text.');
    expect(requiredKeys(blank)).toEqual([]);
  });

  it('summarises sections at every depth, values, copies, references and the first five headings', () => {
    const parameter = (name: string, required: boolean) => ({
      name,
      type: { base: 'text' },
      required,
      list: false,
      changeable: false,
      feeds: { arguments: false },
    });
    const parsed = definition({
      description: 'Survey.',
      outline: {
        sections: [
          starting('a', 'One', { children: [starting('a1', 'One one')] }),
          ...['b', 'c', 'd', 'e', 'f'].map((key) => starting(key, `Section ${key}`)),
        ],
      },
      parameters: [parameter('site', true), parameter('owner', false)],
      components: [
        { key: 'x', component: METHOD, place: { section: null, at: 'start' } },
        { key: 'y', component: METHOD, instantiate: 'copy', place: { section: null, at: 'end' } },
        {
          key: 'z',
          content: { title: 'Z', blocks: [paragraph('z')] },
          place: { section: null, at: 'end' },
        },
      ],
    }).data!;
    expect(templateSummary(parsed)).toEqual({
      description: 'Survey.',
      sections: 7,
      values: 2,
      requiredValues: 1,
      copied: 2,
      referenced: 1,
      headings: ['One', 'Section b', 'Section c', 'Section d', 'Section e'],
    });
    expect(templateSummary(blankTemplate(BLANK_WORDS, THEME, LAYOUT))).toEqual({
      description: null,
      sections: 0,
      values: 0,
      requiredValues: 0,
      copied: 1,
      referenced: 0,
      headings: [],
    });
  });
});
