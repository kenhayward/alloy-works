import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { contentDocumentSchema } from '../content/model/document.js';
import { canonicalJson } from '../stored/canonical.js';
import { canonicaliseVersion, canonicaliseVersionContent } from '../version/substance.js';

import {
  canonicaliseOutline,
  migrateOutline,
  OUTLINE_SCHEMA_VERSION,
  outlineNodeSchema,
  parseOutlineDocument,
  readOutline,
  referenceModeSchema,
  type OutlineDocument,
  type OutlineNode,
} from './outline.js';

const NODE = 'a'.repeat(26);
const OTHER = 'b'.repeat(26);
const COMPONENT = '5e1d0c7a-0b1f-4c1e-9a52-3f6d7c2b9e01';

const fixtures = join(import.meta.dirname, 'fixtures');

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
      readFileSync(join(fixtures, 'v1', 'every-node.json'), 'utf8'),
    );
    const types = new Set<string>();
    const modes = new Set<string>();
    const breaks = new Set<string>();
    const walk = (nodes: readonly OutlineNode[]) => {
      for (const node of nodes) {
        types.add(node.type);
        breaks.add(node.pageBreak);
        if (node.type === 'reference') modes.add(node.mode.kind);
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
