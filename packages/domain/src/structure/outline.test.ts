import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { contentDocumentSchema } from '../content/model/document.js';
import { crossReferenceTargetSchema } from '../content/model/inline.js';
import { canonicalJson } from '../stored/canonical.js';
import { canonicaliseVersion, canonicaliseVersionContent } from '../version/substance.js';

import {
  canonicaliseOutline,
  mayBeFront,
  migrateOutline,
  OUTLINE_SCHEMA_VERSION,
  outlineDocumentSchema,
  outlineMatterSchema,
  outlineNodeSchema,
  parseOutlineDocument,
  readOutline,
  readOutlineView,
  referenceModeSchema,
  walkOutline,
  withholdComponents,
  type OutlineDocument,
  type OutlineNode,
} from './outline.js';

const NODE = 'a'.repeat(26);
const OTHER = 'b'.repeat(26);
const COMPONENT = '5e1d0c7a-0b1f-4c1e-9a52-3f6d7c2b9e01';

const fixtures = join(import.meta.dirname, 'fixtures');
const contentFixtures = join(import.meta.dirname, '..', 'content', 'model', 'fixtures');

/** What this file reads off each arm of `outlineNodeSchema` - the shape, never which schemas fill it. */
type OutlineNodeArm = {
  shape: { type: { value: string }; pageBreak: { options: readonly string[] } } & Record<
    string,
    unknown
  >;
};

/**
 * `outlineNodeSchema` is exported as the widened `z.ZodType<OutlineNode>` (a recursive schema cannot
 * infer its own type), so its arms are not visible through the export's declared type - but it is a
 * `z.lazy` underneath, same as at runtime, so `unwrap()` reaches the discriminated union it wraps.
 * Read this way, rather than by naming `sectionNodeSchema` and `referenceNodeSchema`, so a third arm
 * added to the union later needs no edit in this file to be picked up by either check that uses it.
 */
function outlineNodeArms(): readonly OutlineNodeArm[] {
  return (
    outlineNodeSchema as unknown as { unwrap(): { options: readonly OutlineNodeArm[] } }
  ).unwrap().options;
}

const empty: OutlineDocument = {
  schemaVersion: OUTLINE_SCHEMA_VERSION,
  title: 'The dosing report',
  language: 'en-GB',
  direction: 'ltr',
  nodes: [],
};

const section = (id: string, over: Record<string, unknown> = {}) => ({
  type: 'section',
  id,
  title: [{ type: 'text', value: 'Introduction', marks: [] }],
  numbered: true,
  matter: 'body',
  pageBreak: 'none',
  values: {},
  children: [],
  ...over,
});

describe('the outline a document version holds', () => {
  it('STR-001 gives a document exactly one outline, an ordered tree with nowhere for a second', () => {
    expect(parseOutlineDocument(empty).nodes).toEqual([]);
    const ordered = parseOutlineDocument({ ...empty, nodes: [section(NODE), section(OTHER)] });
    expect(ordered.nodes.map((node) => node.id)).toEqual([NODE, OTHER]);
    // A tree, not a list: a node nests under another, at whatever depth the outline was given.
    const nested = parseOutlineDocument({
      ...empty,
      nodes: [section(NODE, { children: [section(OTHER)] })],
    });
    expect(nested.nodes[0]?.children[0]?.id).toBe(OTHER);
    // The root is closed: there is no second array to put an outline in.
    expect(() => parseOutlineDocument({ ...empty, outline: [] })).toThrow();
    expect(() => parseOutlineDocument({ ...empty, nodes: {} })).toThrow();
  });

  it('STR-002 makes every node either a section or a component reference, and nothing else', () => {
    const both = parseOutlineDocument({
      ...empty,
      nodes: [
        section(NODE, {
          children: [
            {
              type: 'reference',
              id: OTHER,
              component: COMPONENT,
              mode: { kind: 'latest' },
              numbered: true,
              matter: 'body',
              pageBreak: 'none',
              values: {},
              children: [],
            },
          ],
        }),
      ],
    });
    expect(both.nodes[0]?.children[0]?.type).toBe('reference');
    expect(() =>
      parseOutlineDocument({ ...empty, nodes: [{ ...section(NODE), type: 'paragraph' }] }),
    ).toThrow();
  });

  it('gives a node an identifier unique within its outline, as a block has within its component', () => {
    // Not STR-002's own clause - STR-003's, exercised again in task 2 against real allocation.
    expect(() => parseOutlineDocument({ ...empty, nodes: [section(NODE), section(NODE)] })).toThrow(
      /used more than once/,
    );
  });

  it('STR-048 lets a node declare that it begins on a new page, or on a new recto page', () => {
    for (const pageBreak of ['none', 'page', 'recto']) {
      const parsed = parseOutlineDocument({ ...empty, nodes: [section(NODE, { pageBreak })] });
      expect(parsed.nodes[0]).toMatchObject({ pageBreak });
    }
    expect(() =>
      parseOutlineDocument({ ...empty, nodes: [section(NODE, { pageBreak: 'verso' })] }),
    ).toThrow();
    expect(() =>
      parseOutlineDocument({ ...empty, nodes: [{ ...section(NODE), pageBreak: undefined }] }),
    ).toThrow();
  });

  it('STR-049 makes the page-break declaration a property of the node, never of the content', () => {
    // The node carries it, and `contentDocumentSchema`'s root and every block refuse it, so the
    // declaration cannot travel with a component reused somewhere it should not break a page.
    const parsed = parseOutlineDocument({
      ...empty,
      nodes: [section(NODE, { pageBreak: 'page' })],
    });
    expect(parsed.nodes[0]).toHaveProperty('pageBreak', 'page');
    expect(() =>
      contentDocumentSchema.parse({
        schemaVersion: 1,
        title: 'Install the printer',
        language: 'en-GB',
        direction: 'ltr',
        pageBreak: 'page',
        content: [{ type: 'paragraph', id: 'p1', style: 'body', content: [] }],
      }),
    ).toThrow();
    expect(() =>
      contentDocumentSchema.parse({
        schemaVersion: 1,
        title: 'Install the printer',
        language: 'en-GB',
        direction: 'ltr',
        content: [{ type: 'paragraph', id: 'p1', style: 'body', content: [], pageBreak: 'page' }],
      }),
    ).toThrow();
  });

  it('STR-058 records which of the three reference modes a component reference takes', () => {
    const reference = (mode: unknown) => ({
      type: 'reference',
      id: NODE,
      component: COMPONENT,
      mode,
      numbered: true,
      matter: 'body',
      pageBreak: 'none',
      values: {},
      children: [],
    });
    for (const mode of [
      { kind: 'pinned', version: '11111111-1111-4111-8111-111111111111' },
      { kind: 'latest' },
      { kind: 'approved' },
    ]) {
      expect(parseOutlineDocument({ ...empty, nodes: [reference(mode)] }).nodes[0]).toMatchObject({
        mode,
      });
    }
    // The three are closed, absent is not a fourth, and pinned without a version is not pinned.
    expect(() =>
      parseOutlineDocument({ ...empty, nodes: [reference({ kind: 'draft' })] }),
    ).toThrow();
    expect(() =>
      parseOutlineDocument({ ...empty, nodes: [reference({ kind: 'pinned' })] }),
    ).toThrow();
    expect(() =>
      parseOutlineDocument({
        ...empty,
        nodes: [{ ...reference({ kind: 'latest' }), mode: undefined }],
      }),
    ).toThrow();
  });

  it('canonicalises two identical outlines to one string where their marks were built in two orders', () => {
    const marks = [
      { type: 'emphasis', id: 'm2' },
      { type: 'strong', id: 'm1' },
    ];
    const titled = (order: typeof marks) =>
      parseOutlineDocument({
        ...empty,
        nodes: [section(NODE, { title: [{ type: 'text', value: 'Dosing', marks: order }] })],
      });
    const one = titled(marks);
    const other = titled([...marks].reverse());
    expect(canonicaliseOutline(one)).toBe(canonicaliseOutline(other));
    expect(canonicaliseVersionContent({ kind: 'document', content: one })).toBe(
      canonicaliseVersionContent({ kind: 'document', content: other }),
    );
    // The whole version's digest too, not only its content: componentType, definitions, notCarried
    // and values are the same null/[]/[]/{} for both, so the two version digests collapse to one iff
    // the content digest already did.
    expect(canonicaliseVersion({ kind: 'document', content: one })).toBe(
      canonicaliseVersion({ kind: 'document', content: other }),
    );
    // The shared rule, which the version chain's `else` branch would have reached, gives two.
    expect(canonicalJson(one)).not.toBe(canonicalJson(other));
  });

  it('keeps a value in its order, even for a field whose identifier is marks, reached through a section', () => {
    // MET-030's trap, reached from a different direction: `values` is an arbitrary metadata record
    // (STR-060), not content, so a field named `marks` must never be treated as a set the way a
    // title's marks are - `canonicaliseVersion`'s comment names the same trap for a component's
    // values. Shaped like an actual mark (`{type, id}`) so a broken fix that only dodges plain
    // strings still gets caught: these sort if the marks rule reaches them, and only then.
    const forward = [
      { type: 'north', id: '2' },
      { type: 'south', id: '1' },
    ] as const;
    const withValues = (order: readonly { type: string; id: string }[]) =>
      parseOutlineDocument({ ...empty, nodes: [section(NODE, { values: { marks: order } })] });
    const one = withValues(forward);
    const other = withValues([...forward].reverse());
    expect(canonicaliseOutline(one)).toContain(`"values":${canonicalJson({ marks: forward })}`);
    expect(canonicaliseOutline(one)).not.toBe(canonicaliseOutline(other));
    expect(canonicaliseVersionContent({ kind: 'document', content: one })).not.toBe(
      canonicaliseVersionContent({ kind: 'document', content: other }),
    );
  });

  it('reads a stored outline through its own migration chain, and says why one will not read', () => {
    const outcome = readOutline(empty, { artifact: 'a', version: 'v' });
    expect(outcome.ok && outcome.outline.title).toBe('The dosing report');
    const refused = readOutline({ schemaVersion: 1, title: '' }, { artifact: 'a', version: 'v' });
    expect(refused.ok).toBe(false);
    expect(readOutline({}, { artifact: 'a', version: 'v' })).toMatchObject({ ok: false });
  });

  it('reads a stored schema 1 outline as schema 2, member for member', () => {
    // Schema 1 could not hold front matter, so a schema 1 outline this product wrote holds none, and
    // the step to schema 2 changes nothing else: the stored bytes read back as they were written, bar
    // the version they say they are. One holding front matter anyway is refused (the next test).
    const stored: Record<string, unknown> = JSON.parse(
      readFileSync(join(fixtures, 'v1', 'every-node.json'), 'utf8'),
    );
    const outcome = readOutline(stored, { artifact: 'a', version: 'v' });
    expect(outcome).toEqual({ ok: true, outline: { ...stored, schemaVersion: 2 } });
    expect(OUTLINE_SCHEMA_VERSION).toBe(2);
  });

  it('refuses a stored schema 1 outline holding front matter, which schema 1 could never store', () => {
    // Schema 1's parse refused `front`, so a schema 1 row holding it was never written by this
    // product: forged or corrupt, and read as unreadable rather than adopted as schema 2 front matter.
    const stored: Record<string, unknown> = JSON.parse(
      readFileSync(join(fixtures, 'v1', 'every-node.json'), 'utf8'),
    );
    const preface = section('e'.repeat(26), { matter: 'front', numbered: false });
    const nested = section('f'.repeat(26), {
      children: [section('g'.repeat(26), { matter: 'front' })],
    });
    for (const nodes of [
      [preface, ...(stored.nodes as unknown[])],
      [...(stored.nodes as unknown[]), nested],
    ]) {
      expect(readOutline({ ...stored, nodes }, { artifact: 'a', version: 'v' })).toEqual({
        ok: false,
        artifact: 'a',
        version: 'v',
        failure: 'Stored outline at schema version 1 holds front matter, which schema 1 could not',
      });
    }
  });

  it('parses every fixture stored at every schema version, and the fixture holds every node', () => {
    const versions = readdirSync(fixtures);
    expect(versions.length).toBeGreaterThan(0);
    for (const version of versions) {
      for (const file of readdirSync(join(fixtures, version))) {
        const stored: unknown = JSON.parse(readFileSync(join(fixtures, version, file), 'utf8'));
        expect(readOutline(stored, { artifact: 'a', version: 'v' }).ok).toBe(true);
        // Not only that reading succeeded: that the value actually went through the chain and landed
        // at the current schema version, the way `readOutline` would hand it to `parseOutlineDocument`.
        const migrated = migrateOutline(stored) as { schemaVersion: number };
        expect(migrated.schemaVersion).toBe(OUTLINE_SCHEMA_VERSION);
      }
    }
    const every: OutlineDocument = JSON.parse(
      readFileSync(join(fixtures, `v${OUTLINE_SCHEMA_VERSION}`, 'every-node.json'), 'utf8'),
    );
    const types = new Set<string>();
    const modes = new Set<string>();
    const breaks = new Set<string>();
    const matters = new Set<string>();
    const inTitles = new Set<string>();
    const walk = (nodes: readonly OutlineNode[]) => {
      for (const node of nodes) {
        types.add(node.type);
        breaks.add(node.pageBreak);
        matters.add(node.matter);
        if (node.type === 'reference') modes.add(node.mode.kind);
        if (node.type === 'section') for (const inline of node.title) inTitles.add(inline.type);
        walk(node.children);
      }
    };
    walk(parseOutlineDocument(every).nodes);
    // Derived from the schema, not hard-coded, so a fourth arm added and forgotten here fails - the
    // way `content/model/migrate.test.ts`'s own every-node check does.
    const arms = outlineNodeArms();
    const expectedTypes = arms.map((arm) => arm.shape.type.value);
    const expectedModes = referenceModeSchema.options.map((option) => option.shape.kind.value);
    const expectedBreaks = arms[0]!.shape.pageBreak.options;
    expect([...types].sort()).toEqual([...expectedTypes].sort());
    expect([...modes].sort()).toEqual([...expectedModes].sort());
    expect([...breaks].sort()).toEqual([...expectedBreaks].sort());
    expect([...matters].sort()).toEqual([...outlineMatterSchema.options].sort());
    // A title's footnote and cross-reference, so a migration of either is tested against one stored
    // where a title holds it.
    expect([...inTitles].sort()).toEqual(['crossReference', 'footnote', 'text']);
    // Every kind of target stored somewhere: a title holds the `node` kind and a component the rest,
    // so the two every-node fixtures between them hold the union, read from the schema rather than
    // listed here - a fourth kind added and forgotten fails this.
    const targetKinds = new Set<string>();
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(collect);
      if (typeof value !== 'object' || value === null) return;
      const record = value as Record<string, unknown>;
      if (record.type === 'crossReference') {
        targetKinds.add((record.target as { kind: string }).kind);
      }
      Object.values(record).forEach(collect);
    };
    collect(every);
    collect(JSON.parse(readFileSync(join(contentFixtures, 'v1', 'every-node.json'), 'utf8')));
    const expectedKinds = crossReferenceTargetSchema.options.map(
      (option) => option.shape.kind.value,
    );
    expect([...targetKinds].sort()).toEqual([...expectedKinds].sort());
  });

  it('composes a node member by member, and closes over every member the schema declares', () => {
    // The mirror of the marks-as-a-set bug this file's canonical form already fixes: if a member is
    // added to `positional`, or to one arm's own fields, and `canonicaliseOutlineNode` is not taught
    // to compose it too, two outlines differing only in that member would digest identically with no
    // test failing. Guarded here rather than trusted: the composed member names, read back out of the
    // canonical string itself, must be exactly the arm's own member names - added, removed or renamed
    // either side and this fails. Expected members come from `outlineNodeArms()`, keyed by each arm's
    // own `type`, rather than naming `sectionNodeSchema` and `referenceNodeSchema` by hand, so a third
    // arm gets this guard too, the moment a node of that type appears in the outline being checked.
    const expectedMembers = new Map(
      outlineNodeArms().map((arm) => [arm.shape.type.value, Object.keys(arm.shape).sort()]),
    );
    const outline = parseOutlineDocument({
      ...empty,
      nodes: [
        section(NODE, {
          children: [
            {
              type: 'reference',
              id: OTHER,
              component: COMPONENT,
              mode: { kind: 'latest' },
              numbered: true,
              matter: 'body',
              pageBreak: 'none',
              values: {},
              children: [],
            },
          ],
        }),
      ],
    });
    const composed = JSON.parse(canonicaliseOutline(outline));
    const checkComposedMembers = (node: { type: string; children: unknown[] }): void => {
      expect(Object.keys(node).sort()).toEqual(expectedMembers.get(node.type));
      for (const child of node.children) checkComposedMembers(child as typeof node);
    };
    for (const node of composed.nodes as { type: string; children: unknown[] }[]) {
      checkComposedMembers(node);
    }
  });
});

describe('a section title, under the content model rules', () => {
  const titled = (title: unknown) => ({ ...empty, nodes: [section(NODE, { title })] });
  const footnote = (content: unknown) => ({
    type: 'footnote',
    id: 'f1',
    anchor: { kind: 'span' },
    content,
  });
  const paragraph = {
    type: 'paragraph',
    id: 'p1',
    style: 'body',
    content: [{ type: 'text', value: 'Measured at the bench.', marks: [] }],
  };
  const words = { type: 'text', value: 'Method', marks: [] };

  it('refuses a footnote in a title whose content is not paragraphs, as a component refuses one', () => {
    expect(() =>
      parseOutlineDocument(titled([words, footnote([{ script: '<x>' }, 42])])),
    ).toThrow();
    expect(() => parseOutlineDocument(titled([words, footnote([])]))).toThrow();
    // Nested: a footnote inside a footnote is refused outright.
    expect(() =>
      parseOutlineDocument(
        titled([words, footnote([{ ...paragraph, content: [footnote([{ table: true }])] }])]),
      ),
    ).toThrow();
    // What the content model admits in a heading, the outline admits too.
    const parsed = parseOutlineDocument(titled([words, footnote([paragraph])]));
    expect(parsed.nodes[0]).toMatchObject({ title: [words, footnote([paragraph])] });
  });

  it('lets a cross-reference in a title target an outline node, and nothing a title cannot show', () => {
    const reference = (id: string, target: unknown) => ({
      type: 'crossReference',
      id,
      target,
      display: 'number',
    });
    const toNode = { kind: 'node', node: OTHER };
    expect(() => parseOutlineDocument(titled([words, reference('x1', toNode)]))).not.toThrow();
    // A block of "its own" component: a title is in no component.
    expect(() =>
      parseOutlineDocument(titled([words, reference('x1', { kind: 'block', block: 'b2' })])),
    ).toThrow(/content model refuses/);
    // Another component's block: an outline is answered with a component the reader may not read
    // withheld, and a title's reference would carry its identity past that (decision E).
    expect(() =>
      parseOutlineDocument(
        titled([words, reference('x1', { kind: 'component', component: COMPONENT, block: 'b2' })]),
      ),
    ).toThrow(/content model refuses/);
    // And its identifier is unique within the title.
    expect(() =>
      parseOutlineDocument(titled([words, reference('x1', toNode), reference('x1', toNode)])),
    ).toThrow(/content model refuses/);
  });

  it('lets a reference in a title show a number or a page, and never a title, so no title can loop', () => {
    const shown = (display: string, withoutPages?: string) => ({
      type: 'crossReference',
      id: 'x1',
      target: { kind: 'node', node: OTHER },
      display,
      ...(withoutPages === undefined ? {} : { withoutPages }),
    });
    for (const reference of [shown('number'), shown('page'), shown('page', 'number')]) {
      expect(() => parseOutlineDocument(titled([words, reference]))).not.toThrow();
    }
    // Resolving a title that shows a title resolves that title: a node naming itself, or two titles
    // naming each other, would never finish. And a page reference falls back, where there are no
    // pages, to the form it declares - so that form is held to the same rule.
    for (const reference of [
      shown('title'),
      shown('numberAndTitle'),
      shown('relative'),
      shown('page', 'title'),
      shown('page', 'numberAndTitle'),
    ]) {
      expect(() => parseOutlineDocument(titled([words, reference]))).toThrow(
        /content model refuses/,
      );
    }
  });

  it('holds a footnote in a title as parsed, so its defaults spelled out or omitted give one string', () => {
    const spelled = parseOutlineDocument(titled([words, footnote([paragraph])]));
    const omitted = parseOutlineDocument(
      titled([
        words,
        footnote([
          {
            type: 'paragraph',
            id: 'p1',
            content: [{ type: 'text', value: 'Measured at the bench.' }],
          },
        ]),
      ]),
    );
    expect(omitted).toEqual(spelled);
    expect(canonicaliseOutline(omitted)).toBe(canonicaliseOutline(spelled));
  });

  it('merges adjacent runs in a title, so a split and a whole spelling give one digest', () => {
    const emphasis = [{ type: 'emphasis', id: 'm1' }];
    const split = parseOutlineDocument(
      titled([
        { type: 'text', value: 'Dosing ', marks: emphasis },
        { type: 'text', value: '', marks: [] },
        { type: 'text', value: 'the sample', marks: emphasis },
      ]),
    );
    const whole = parseOutlineDocument(
      titled([{ type: 'text', value: 'Dosing the sample', marks: emphasis }]),
    );
    expect(split).toEqual(whole);
    expect(canonicaliseOutline(split)).toBe(canonicaliseOutline(whole));
  });

  it('keeps every identifier inside a title unique within that title, as a component keeps its own', () => {
    const second = { ...footnote([{ ...paragraph, id: 'p2' }]), id: 'f2' };
    expect(() =>
      parseOutlineDocument(titled([words, footnote([paragraph]), second])),
    ).not.toThrow();
    // Two footnotes sharing an identifier, and a footnote's paragraph sharing its footnote's.
    expect(() =>
      parseOutlineDocument(titled([words, footnote([paragraph]), { ...second, id: 'f1' }])),
    ).toThrow(/content model refuses/);
    expect(() =>
      parseOutlineDocument(titled([words, footnote([{ ...paragraph, id: 'f1' }])])),
    ).toThrow(/content model refuses/);
    // An identifier not in NFC, which the canonical form would fold into its composed spelling.
    expect(() =>
      parseOutlineDocument(titled([words, { ...footnote([paragraph]), id: 'café' }])),
    ).toThrow(/content model refuses/);
    // Two sections are two titles: the same footnote identifier in each is not a collision, because
    // anything in a title is reached through its node, as anything in a component is through its
    // occurrence.
    expect(() =>
      parseOutlineDocument({
        ...empty,
        nodes: [
          section(NODE, { title: [words, footnote([paragraph])] }),
          section(OTHER, { title: [words, footnote([paragraph])] }),
        ],
      }),
    ).not.toThrow();
  });
});

describe('what a stored outline refuses, because nothing later could take it back', () => {
  it('holds its language to the content model rule itself, not to a copy of it', () => {
    expect(outlineDocumentSchema.shape.language).toBe(contentDocumentSchema.shape.language);
  });

  const titled = (title: unknown) => ({ ...empty, nodes: [section(NODE, { title })] });
  const words = (value: string) => ({ type: 'text', value, marks: [] });

  it('refuses a section title with no text, or text that is only whitespace', () => {
    expect(() => parseOutlineDocument(titled([]))).toThrow();
    expect(() => parseOutlineDocument(titled([words('  \t ')]))).toThrow();
    expect(() => parseOutlineDocument(titled([words(''), words(' ')]))).toThrow();
    expect(parseOutlineDocument(titled([words(' Method ')])).nodes).toHaveLength(1);
    // And the document's own title, which creation trims and the parse holds to the same rule.
    expect(() => parseOutlineDocument({ ...empty, title: '   ' })).toThrow();
  });

  it('refuses a character Postgres cannot store in JSON: a NUL, or half of a surrogate pair', () => {
    for (const value of ['Me\u0000thod', 'Method \uD800', '\uDC00 Method', 'Method \uDBFFx']) {
      expect(() => parseOutlineDocument(titled([words(value)]))).toThrow();
      expect(() => parseOutlineDocument({ ...empty, title: value })).toThrow();
    }
    // Deeper than the title's own runs: inside a footnote's paragraph, too.
    expect(() =>
      parseOutlineDocument(
        titled([
          words('Method'),
          {
            type: 'footnote',
            id: 'f1',
            anchor: { kind: 'span' },
            content: [{ type: 'paragraph', id: 'p1', style: 'body', content: [words('a\u0000')] }],
          },
        ]),
      ),
    ).toThrow();
    // A whole pair is one character, and is stored as one.
    const pair = 'Method \uD83D\uDE00';
    expect(parseOutlineDocument(titled([words(pair)])).nodes[0]).toMatchObject({
      title: [words(pair)],
    });
    expect(parseOutlineDocument({ ...empty, title: pair }).title).toBe(pair);
  });
});

describe('what the parse bounds', () => {
  /** A distinct identifier for each level: four digits spelled as letters, as the operations test does. */
  const idAt = (level: number) =>
    `${String(level).padStart(4, '0')}${'a'.repeat(22)}`.replace(
      /\d/g,
      (digit) => 'abcdefghij'[Number(digit)]!,
    );
  /** One section per level, each the only child of the one above it. */
  const nested = (
    levels: number,
    over: (level: number) => Record<string, unknown> = () => ({}),
  ) => {
    let node: Record<string, unknown> | null = null;
    for (let level = levels; level >= 1; level -= 1) {
      node = section(idAt(level), { children: node === null ? [] : [node], ...over(level) });
    }
    return { ...empty, nodes: node === null ? [] : [node] };
  };

  it('reads an outline 64 levels deep, and refuses one a level deeper, however deep it goes', () => {
    let deepest = 0;
    walkOutline(parseOutlineDocument(nested(64)).nodes, (_node, depth) => {
      deepest = Math.max(deepest, depth);
    });
    expect(deepest).toBe(64);
    expect(() => parseOutlineDocument(nested(65))).toThrow(/no deeper than 64 levels/);
    // Refused by the bound, never by the stack: deep enough to overflow a recursive parse.
    expect(() => parseOutlineDocument(nested(5000))).toThrow(/no deeper than 64 levels/);
  });

  it('STR-064 refuses front matter below the top level, and after any top-level node that is not front matter', () => {
    const PREFACE = 'e'.repeat(26);
    const THANKS = 'f'.repeat(26);
    const GLOSSARY = 'g'.repeat(26);
    const accepted = parseOutlineDocument({
      ...empty,
      nodes: [
        section(PREFACE, { matter: 'front', numbered: false }),
        section(THANKS, { matter: 'front' }),
        section(NODE, { children: [section(OTHER)] }),
        section(GLOSSARY, { matter: 'appendix' }),
      ],
    });
    expect(accepted.nodes.map((node) => node.matter)).toEqual([
      'front',
      'front',
      'body',
      'appendix',
    ]);
    // After the body, and after an appendix: named, by the node that broke the rule.
    expect(() =>
      parseOutlineDocument({
        ...empty,
        nodes: [section(NODE), section(PREFACE, { matter: 'front' })],
      }),
    ).toThrow(`Outline node ${PREFACE} is front matter after the rest of the outline has begun`);
    expect(() =>
      parseOutlineDocument({
        ...empty,
        nodes: [section(GLOSSARY, { matter: 'appendix' }), section(PREFACE, { matter: 'front' })],
      }),
    ).toThrow(`Outline node ${PREFACE} is front matter after the rest of the outline has begun`);
    // Below the top level, even under front matter itself: a subtree inherits its matter.
    expect(() =>
      parseOutlineDocument({
        ...empty,
        nodes: [
          section(PREFACE, {
            matter: 'front',
            children: [section(THANKS, { matter: 'front' })],
          }),
        ],
      }),
    ).toThrow(`Outline node ${THANKS} sets its matter below the top level`);
  });

  it('mayBeFront answers yes for a leading run of top-level nodes and no after the body begins', () => {
    const nodes = [
      { id: 'a', matter: 'front', children: [] },
      { id: 'b', matter: 'body', children: [{ id: 'child', matter: 'body', children: [] }] },
      { id: 'c', matter: 'body', children: [] },
    ];
    expect(mayBeFront(nodes, 'a')).toBe(true);
    // The first node that is not front matter may become it: nothing but front matter precedes it.
    expect(mayBeFront(nodes, 'b')).toBe(true);
    expect(mayBeFront(nodes, 'c')).toBe(false);
    // A node below the top level is never where front matter may be set, nor is one not there at all.
    expect(mayBeFront(nodes, 'child')).toBe(false);
    expect(mayBeFront(nodes, 'missing')).toBe(false);
  });

  it('refuses an appendix anywhere but the top level, where its subtree inherits it', () => {
    expect(
      parseOutlineDocument(nested(3, (level) => (level === 1 ? { matter: 'appendix' } : {})))
        .nodes[0],
    ).toMatchObject({ matter: 'appendix' });
    expect(() =>
      parseOutlineDocument(nested(3, (level) => (level === 2 ? { matter: 'appendix' } : {}))),
    ).toThrow(/top level/);
    expect(() =>
      parseOutlineDocument(nested(3, (level) => ({ matter: level === 3 ? 'appendix' : 'body' }))),
    ).toThrow(/top level/);
  });
});

describe('an outline as a reader is shown it', () => {
  const HIDDEN = '7c2e9b41-3a6d-4f18-8e05-1d9a4c6b8f27';
  const VERSION = '11111111-1111-4111-8111-111111111111';
  const reference = (id: string, component: string, mode: unknown, over = {}) => ({
    type: 'reference',
    id,
    component,
    mode,
    numbered: true,
    matter: 'body',
    pageBreak: 'page',
    values: {},
    children: [],
    ...over,
  });
  const stored = parseOutlineDocument({
    ...empty,
    nodes: [
      section(NODE, {
        children: [reference(OTHER, HIDDEN, { kind: 'pinned', version: VERSION })],
      }),
      reference('c'.repeat(26), COMPONENT, { kind: 'pinned', version: VERSION }),
      reference('d'.repeat(26), HIDDEN, { kind: 'latest' }),
    ],
  });

  it('withholds the component and pinned version of a reference the reader may not read, and keeps the node', () => {
    const view = withholdComponents(stored, (component) => component === COMPONENT);
    expect(JSON.stringify(view)).not.toContain(HIDDEN);
    expect(view.nodes[0]!.children[0]).toEqual({
      ...reference(OTHER, HIDDEN, { kind: 'pinned', version: VERSION }),
      component: null,
      mode: { kind: 'pinned', version: null },
    });
    // What the reader may read is shown as it is stored.
    expect(view.nodes[1]).toEqual(stored.nodes[1]);
    expect(view.nodes[2]).toMatchObject({ component: null, mode: { kind: 'latest' } });
    // The stored outline is not touched: the view is a copy.
    expect(JSON.stringify(stored)).toContain(HIDDEN);
    // And the view reads back as a view, but never as a stored outline.
    const read = readOutlineView(JSON.parse(JSON.stringify(view)), { artifact: 'a', version: 'v' });
    expect(read).toEqual({ ok: true, outline: view });
    expect(readOutline(JSON.parse(JSON.stringify(view)), { artifact: 'a', version: 'v' }).ok).toBe(
      false,
    );
    // Everything a stored outline refuses, a view refuses too.
    expect(readOutlineView({ ...view, title: ' ' }, { artifact: 'a', version: 'v' }).ok).toBe(
      false,
    );
  });
});
