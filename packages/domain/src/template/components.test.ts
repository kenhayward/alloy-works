import { describe, expect, it } from 'vitest';

import { applyOutlineOperation } from '../structure/operations.js';
import { walkOutline, type OutlineNode } from '../structure/outline.js';

import { missingComponents, requiredKeys } from './conformance.js';
import { TEMPLATE_SCHEMA_VERSION, templateDefinitionSchema } from './definition.js';
import { materialiseTemplate } from './materialise.js';
import { resolveTemplate, type TemplateReferences } from './resolve.js';

const THEME = '4ae73bd5-0000-4000-8000-000000002866';
const LAYOUT = '1a7e0a2b-0000-4000-8000-00000000f501';
const METHOD = 'c0c0c0c0-0000-4000-8000-000000000001';
const NOTICE = 'c0c0c0c0-0000-4000-8000-000000000002';
const METHOD_V2 = 'c0c0c0c0-0000-4000-8000-0000000000a2';
const NOTICE_V1 = 'c0c0c0c0-0000-4000-8000-0000000000b1';
const DEPTHS = 'd0d0d0d0-0000-4000-8000-000000000001';

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

const definition = (components: unknown[]) =>
  templateDefinitionSchema.safeParse({
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    name: 'Survey report',
    theme: THEME,
    layout: LAYOUT,
    schemas: [],
    outline: {
      sections: [
        starting('summary', 'Summary', { matter: 'front' }),
        starting('method', 'Method'),
        starting('annex', 'Annex', { matter: 'appendix' }),
      ],
    },
    changes: { add: true, remove: true, reorder: true },
    components,
  });

const twoComponents = [
  { key: 'statement', component: METHOD, place: { section: 'method', at: 'start' } },
  {
    key: 'notice',
    component: NOTICE,
    mode: { kind: 'pinned', version: NOTICE_V1 },
    place: { section: null, at: 'end' },
  },
];

const found = (over: Partial<TemplateReferences> = {}): TemplateReferences => ({
  kinds: new Map([
    [THEME, 'theme'],
    [LAYOUT, 'layout'],
  ]),
  schemas: [],
  fields: [],
  components: new Map([
    ['statement', { state: 'found', version: METHOD_V2, bindings: [DEPTHS] }],
    ['notice', { state: 'found', version: NOTICE_V1, bindings: [] }],
  ]),
  definitions: new Set([DEPTHS]),
  ...over,
});

describe('required components on a template (the R9 plan, R9-A to R9-D)', () => {
  it('TPL-014 declares components every document from it includes, each with its key, its mode and its place', () => {
    const parsed = definition(twoComponents);
    expect(parsed.success).toBe(true);
    expect(parsed.data!.components).toHaveLength(2);
    // Its key is one namespace with the starting sections', and its place names one of them.
    expect(
      definition([{ key: 'method', component: METHOD, place: { section: null, at: 'start' } }])
        .success,
    ).toBe(false);
    expect(
      definition([{ key: 'x', component: METHOD, place: { section: 'nowhere', at: 'start' } }])
        .success,
    ).toBe(false);
  });

  it('TPL-070 computes its query set from the bindings of the components it requires, and resolves only where each is there to read', () => {
    const parsed = definition(twoComponents).data!;
    const answer = resolveTemplate(parsed, found());
    if (!answer.ok) throw new Error(JSON.stringify(answer.unresolved));
    expect(answer.querySet).toEqual([DEPTHS]);
    expect(answer.components.map((each) => [each.key, each.version])).toEqual([
      ['statement', METHOD_V2],
      ['notice', NOTICE_V1],
    ]);

    const unresolved = resolveTemplate(
      parsed,
      found({
        components: new Map([['notice', { state: 'foreign' }]]),
        definitions: new Set(),
      }),
    );
    expect(unresolved).toEqual({
      ok: false,
      unresolved: [
        { reference: 'component', id: METHOD, key: 'statement', why: 'missing' },
        { reference: 'component', id: NOTICE, key: 'notice', why: 'foreign' },
      ],
    });
    // A component there, whose binding names a definition the creator may not read or that is gone.
    expect(resolveTemplate(parsed, found({ definitions: new Set() }))).toEqual({
      ok: false,
      unresolved: [{ reference: 'query', id: DEPTHS, key: 'statement' }],
    });
  });

  it('TPL-014 places each as a reference carrying its key, in the section or at the top level it names, with its mode', () => {
    const answer = resolveTemplate(definition(twoComponents).data!, found());
    if (!answer.ok) throw new Error('unresolved');
    let n = 0;
    const { outline } = materialiseTemplate(
      answer,
      { title: 'Site 4', language: 'en-GB', direction: 'ltr' },
      () => 'a'.repeat(25) + 'bcdefghijklmnopqrstuvwxyz'[(n += 1) - 1]!,
    );
    const top = outline.nodes.map((node) =>
      node.type === 'reference' ? `ref:${node.origin}` : `section:${node.origin}`,
    );
    // At the top level's end, before the appendices; at the start of Method.
    expect(top).toEqual(['section:summary', 'section:method', 'ref:notice', 'section:annex']);
    const method = outline.nodes[1]!;
    expect(method.children[0]).toMatchObject({
      type: 'reference',
      component: METHOD,
      origin: 'statement',
      mode: { kind: 'approved' },
      matter: 'body',
    });
    expect(outline.nodes[2]).toMatchObject({ mode: { kind: 'pinned', version: NOTICE_V1 } });
  });

  it('TPL-044 refuses removing a required component without a reason, and names one missing and not waived', () => {
    const parsed = definition(twoComponents).data!;
    const answer = resolveTemplate(parsed, found());
    if (!answer.ok) throw new Error('unresolved');
    let n = 0;
    const { outline } = materialiseTemplate(
      answer,
      { title: 'Site 4', language: 'en-GB', direction: 'ltr' },
      () => 'a'.repeat(25) + 'bcdefghijklmnopqrstuvwxyz'[(n += 1) - 1]!,
    );
    expect(requiredKeys(parsed)).toEqual(expect.arrayContaining(['statement', 'notice']));
    let notice = '';
    walkOutline(outline.nodes, (node: OutlineNode) => {
      if (node.type === 'reference' && node.origin === 'notice') notice = node.id;
    });
    const rules = { required: requiredKeys(parsed) };
    const refused = applyOutlineOperation(
      outline,
      { operation: 'remove', node: notice },
      () => 'x',
      rules,
    );
    expect(refused.applied).toBe(false);
    const removed = applyOutlineOperation(
      outline,
      { operation: 'remove', node: notice, reason: 'Issued without the notice by agreement' },
      () => 'x',
      rules,
    );
    if (!removed.applied) throw new Error('refused');
    expect(missingComponents(parsed, removed.outline)).toEqual([
      { key: 'notice', component: NOTICE },
    ]);
    expect(missingComponents(parsed, removed.outline, new Set(['notice']))).toEqual([]);
    expect(missingComponents(parsed, outline)).toEqual([]);
  });

  it('TPL-073 places a top-level component as front matter, body or an appendix, as the template says, and refuses matter on one in a section', () => {
    const parsed = definition([
      {
        key: 'statement',
        component: METHOD,
        mode: { kind: 'latest' },
        place: { section: null, at: 'start', matter: 'front' },
      },
      {
        key: 'notice',
        component: NOTICE,
        mode: { kind: 'latest' },
        place: { section: null, at: 'end', matter: 'appendix' },
      },
    ]).data!;
    const answer = resolveTemplate(parsed, found());
    if (!answer.ok) throw new Error('unresolved');
    let n = 0;
    const { outline } = materialiseTemplate(
      answer,
      { title: 'Site 4', language: 'en-GB', direction: 'ltr' },
      () => 'a'.repeat(25) + 'bcdefghijklmnopqrstuvwxyz'[(n += 1) - 1]!,
    );
    expect(outline.nodes.map((node) => [node.origin, node.matter])).toEqual([
      ['statement', 'front'],
      ['summary', 'front'],
      ['method', 'body'],
      ['annex', 'appendix'],
      ['notice', 'appendix'],
    ]);
    expect(
      definition([
        {
          key: 'x',
          component: METHOD,
          place: { section: 'method', at: 'start', matter: 'appendix' },
        },
      ]).success,
    ).toBe(false);
  });
});
