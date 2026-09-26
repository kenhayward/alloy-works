import { describe, expect, it } from 'vitest';

import { canonicaliseVersion } from '../version/substance.js';

import { TEMPLATE_SCHEMA_VERSION, templateDefinitionSchema } from './definition.js';

const THEME = '4ae73bd5-0000-4000-8000-000000002866';
const LAYOUT = '1a7e0a2b-0000-4000-8000-00000000f501';
const REVIEW = '5c4e0000-0000-4000-8000-000000000001';

const title = (words: string) => [{ type: 'text', value: words, marks: [] }];

/** A starting section, body matter, numbered, not required, unless `over` says otherwise. */
const section = (key: string, words: string, over: object = {}, children: object[] = []) => ({
  key,
  title: title(words),
  required: false,
  numbered: true,
  matter: 'body',
  pageBreak: 'none',
  children,
  ...over,
});

/** A definition binding the one theme and layout, starting with these sections. */
const template = (over: object = {}) => ({
  schemaVersion: TEMPLATE_SCHEMA_VERSION,
  name: 'Report',
  theme: THEME,
  layout: LAYOUT,
  schemas: [],
  outline: { sections: [section('introduction', 'Introduction')] },
  changes: { add: true, remove: true, reorder: true },
  ...over,
});

const parses = (value: unknown) => templateDefinitionSchema.safeParse(value).success;

describe('a template definition', () => {
  it('TPL-059 binds exactly one outline, theme and layout, and any number of schemas', () => {
    expect(parses(template())).toBe(true);
    for (const member of ['outline', 'theme', 'layout']) {
      const without = { ...template() } as Record<string, unknown>;
      delete without[member];
      expect(parses(without), `without ${member}`).toBe(false);
    }
    // One of each, never two: a theme or a layout is one identifier, and an outline one tree.
    expect(parses(template({ theme: [THEME, THEME] }))).toBe(false);
    expect(parses(template({ layout: [LAYOUT, LAYOUT] }))).toBe(false);
    expect(parses(template({ outline: [{ sections: [] }, { sections: [] }] }))).toBe(false);
    // Any number of schemas, none included.
    expect(parses(template({ schemas: [] }))).toBe(true);
    expect(
      parses(
        template({
          schemas: [
            { schema: REVIEW, level: 'document', requires: [] },
            { schema: '5c4e0000-0000-4000-8000-000000000002', level: 'section', requires: [] },
          ],
        }),
      ),
    ).toBe(true);
  });

  it('TPL-012 declares the sections a document starts with, in order', () => {
    const parsed = templateDefinitionSchema.parse(
      template({
        outline: {
          sections: [
            section('introduction', 'Introduction'),
            section('method', 'Method', {}, [section('equipment', 'Equipment')]),
            section('results', 'Results'),
          ],
        },
      }),
    );
    expect(parsed.outline.sections.map((each) => each.key)).toEqual([
      'introduction',
      'method',
      'results',
    ]);
    expect(parsed.outline.sections[1]!.children.map((each) => each.key)).toEqual(['equipment']);
  });

  it('TPL-013 marks a starting section required', () => {
    const parsed = templateDefinitionSchema.parse(
      template({
        outline: {
          sections: [
            section('introduction', 'Introduction', { required: true }),
            section('appendix', 'Appendix', { matter: 'appendix' }),
          ],
        },
      }),
    );
    expect(parsed.outline.sections.map((each) => each.required)).toEqual([true, false]);
    // Required is said, never assumed: a section that does not say is refused.
    const unsaid: Record<string, unknown> = { ...section('introduction', 'Introduction') };
    delete unsaid.required;
    expect(parses(template({ outline: { sections: [unsaid] } }))).toBe(false);
  });

  it('TPL-015 declares whether sections may be added, removed or reordered', () => {
    const fixed = templateDefinitionSchema.parse(
      template({ changes: { add: false, remove: false, reorder: false } }),
    );
    expect(fixed.changes).toEqual({ add: false, remove: false, reorder: false });
    // Each of the three is said: none is taken to be allowed by being left out.
    expect(parses(template({ changes: { add: true, remove: true } }))).toBe(false);
    expect(
      parses(template({ changes: { add: true, remove: true, reorder: true, merge: true } })),
    ).toBe(false);
  });

  it("TPL-054 assigns a schema at the document's level or a section's, and can only make a field required", () => {
    const assigned = templateDefinitionSchema.parse(
      template({
        schemas: [
          { schema: REVIEW, level: 'document', requires: ['owner'] },
          { schema: REVIEW, level: 'section', requires: [] },
        ],
      }),
    );
    expect(assigned.schemas.map((each) => each.level)).toEqual(['document', 'section']);
    // No level but the two.
    expect(
      parses(template({ schemas: [{ schema: REVIEW, level: 'paragraph', requires: [] }] })),
    ).toBe(false);
    // Nothing that could loosen a field, change its default or fix its value (MET-009).
    for (const member of [
      { optional: ['owner'] },
      { default: { owner: 'Ada' } },
      { fixed: ['owner'] },
    ]) {
      expect(
        parses(
          template({ schemas: [{ schema: REVIEW, level: 'document', requires: [], ...member }] }),
        ),
        JSON.stringify(member),
      ).toBe(false);
    }
    // One assignment of a schema at a level, and a field required once.
    expect(
      parses(
        template({
          schemas: [
            { schema: REVIEW, level: 'document', requires: [] },
            { schema: REVIEW, level: 'document', requires: [] },
          ],
        }),
      ),
    ).toBe(false);
    expect(
      parses(
        template({
          schemas: [{ schema: REVIEW, level: 'document', requires: ['owner', 'owner'] }],
        }),
      ),
    ).toBe(false);
  });

  it('refuses two starting sections with one key, anywhere in the tree', () => {
    expect(
      parses(
        template({
          outline: {
            sections: [
              section('method', 'Method', {}, [section('results', 'Results')]),
              section('results', 'Results again'),
            ],
          },
        }),
      ),
    ).toBe(false);
  });

  it('refuses front matter after the body, as an outline does', () => {
    expect(
      parses(
        template({
          outline: {
            sections: [section('body', 'Body'), section('preface', 'Preface', { matter: 'front' })],
          },
        }),
      ),
    ).toBe(false);
  });

  it('refuses a starting title with no words, or with a cross-reference it has nothing to point at', () => {
    expect(parses(template({ outline: { sections: [section('blank', '   ')] } }))).toBe(false);
    const referring = {
      ...section('intro', 'Introduction'),
      title: [
        ...title('See '),
        {
          type: 'crossReference',
          id: 'x1',
          target: { kind: 'node', node: 'aaaaaaaaaaaaaaaaaaaaaaaaaa' },
          display: 'number',
        },
      ],
    };
    expect(parses(template({ outline: { sections: [referring] } }))).toBe(false);
  });

  it('refuses a key that is not a plain token, and a name with no words', () => {
    expect(parses(template({ outline: { sections: [section('two words', 'Intro')] } }))).toBe(
      false,
    );
    expect(parses(template({ name: '  ' }))).toBe(false);
  });

  it("digests two spellings of one template alike: a title's marks are a set", () => {
    const marked = (marks: object[]) =>
      templateDefinitionSchema.parse(
        template({
          outline: {
            sections: [
              {
                ...section('introduction', 'Introduction'),
                title: [{ type: 'text', value: 'Introduction', marks }],
              },
            ],
          },
        }),
      );
    const one = marked([
      { type: 'strong', id: 'm1' },
      { type: 'emphasis', id: 'm2' },
    ]);
    const other = marked([
      { type: 'emphasis', id: 'm2' },
      { type: 'strong', id: 'm1' },
    ]);
    expect(canonicaliseVersion({ kind: 'template', content: one })).toBe(
      canonicaliseVersion({ kind: 'template', content: other }),
    );
  });
});
