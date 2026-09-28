import { describe, expect, it } from 'vitest';

import { parseContentDocument, type ContentDocument } from '../content/model/document.js';
import { contributionsOf } from '../structure/contributions.js';
import { contents, listOf } from '../structure/lists.js';
import { conditions, number, resolve, type NumberingTable } from '../structure/numbering.js';
import {
  OUTLINE_SCHEMA_VERSION,
  parseOutlineDocument,
  type OutlineDocument,
  type ReferenceNode,
} from '../structure/outline.js';
import { referenceResolver } from '../structure/references.js';
import { defaultNumberingScheme } from '../structure/scheme.js';
import { resolved } from '../theme/theme.fixture.js';

import { assemble, type AssembleInput } from './assemble.js';
import { defaultLayout, parseLayout, type Layout } from './layout.js';
import type { PublishedBlock, PublishedInline, PublishedNode } from './published.js';

/**
 * The resolution order (publishing.md, "The order"), each adjacent pair of its stages that exists in
 * T1 tested in turn:
 *
 * ```
 * 1 resolve  2 conditions  3 contribute  4 number  5 references  6 generate  7 check  8 project
 * ```
 *
 * Where the code lets a test swap two stages - each is a function of its own, `conditionContent`,
 * `contributionsOf`, `number`, `referenceResolver`, `listOf` - the test composes them the other way
 * round and shows the output differs. Where the types forbid the swap, the test says so and shows the
 * refusal with `@ts-expect-error`, which `pnpm typecheck` holds: were the types to allow the swap,
 * the directive would be unused and the typecheck would fail.
 *
 * The last stages are not functions a test can reorder. `assemble` runs, in this order: conditions
 * over each occurrence's content, contributions, the outline's own conditions, `number`, the check
 * that Word would number alike where Word is asked for, the references, one walk over the document
 * that checks each block and projects it at once, and then the generated matter - whether the
 * contents and each list the layout declares has an entry - and the check that there is something to
 * publish, which reads it; the projection is returned only where no check failed. So the walk's checks
 * read nothing generation makes, and the one check that does comes after it: the test shows that check
 * reading generation's answer, and shows a document that fails a check never projected, which the
 * types refuse too.
 */

const id = (name: string) => name.padEnd(26, 'a');
const COMPONENT = '00000000-0000-4000-8000-000000000001';
const text = (value: string) => ({ type: 'text', value, marks: [] });
const xref = (name: string, block: string) => ({
  type: 'crossReference',
  id: name,
  target: { kind: 'block', block },
  display: 'number',
});
const cell = (name: string, words: string) => ({
  content: [{ type: 'paragraph', id: name, style: 'body', content: [text(words)] }],
  colspan: 1,
  rowspan: 1,
});
const table = (name: string, caption: unknown[]) => ({
  type: 'table',
  id: name,
  style: 'table',
  caption,
  headerRows: 1,
  headerColumns: 0,
  rows: [{ cells: [cell(`${name}h`, 'Site')] }, { cells: [cell(`${name}b`, 'York')] }],
});

/**
 * One component under one section: a table a condition will hide, a second table, a third whose
 * caption refers to the second by its number, and a paragraph that does too.
 */
const outline: OutlineDocument = parseOutlineDocument({
  schemaVersion: OUTLINE_SCHEMA_VERSION,
  title: 'The dosing report',
  language: 'en-GB',
  direction: 'ltr',
  nodes: [
    {
      type: 'section',
      id: id('intro'),
      title: [text('Introduction')],
      numbered: true,
      matter: 'body',
      pageBreak: 'none',
      values: {},
      children: [
        {
          type: 'reference',
          id: id('calib'),
          component: COMPONENT,
          mode: { kind: 'latest' },
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
const stored: ContentDocument = parseContentDocument({
  schemaVersion: 1,
  title: 'Calibration',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    table('t1', [text('Hidden')]),
    table('t2', [text('Pressures')]),
    table('t3', [text('Readings after '), xref('x1', 't2')]),
    { type: 'paragraph', id: 'p1', style: 'body', content: [text('See '), xref('x2', 't2')] },
  ],
});
/** Standing in for REU's conditions (T4): the first table is in a passage a condition hides. */
const hiding = (_node: string, content: ContentDocument): ContentDocument => ({
  ...content,
  content: content.content.filter((block) => block.id !== 't1'),
});
const occurrences = new Map([[id('calib'), stored]]);

const input = (
  over: Partial<AssembleInput & { readonly layout: Layout }> = {},
): AssembleInput & { readonly layout: Layout } => ({
  formats: ['pdf'],
  outline,
  occurrences,
  conditionContent: hiding,
  refused: [],
  layout: defaultLayout,
  theme: resolved(),
  revision: '0.1',
  covers: () => true,
  assets: new Map(),
  ...over,
});

/** The tables' labels a numbering gives, by block. */
const tableLabels = (numbering: NumberingTable) =>
  Object.fromEntries(
    numbering.entries
      .filter((entry) => entry.sequence === 'table')
      .map((entry) => [entry.block, entry.label]),
  );

/** Every block a node publishes, those nested in its children's too. */
const blocksOf = (nodes: readonly PublishedNode[]): PublishedBlock[] =>
  nodes.flatMap((node) => [...node.blocks, ...blocksOf(node.children)]);
/** What a run of published inline content prints. */
const printed = (runs: readonly PublishedInline[]) =>
  runs
    .map((run) => ('reference' in run ? (run.reference.text ?? '') : 'text' in run ? run.text : ''))
    .join('');

/** Stages 2 to 4 as `assemble` composes them, for the one occurrence. */
const numbered = (content: ContentDocument) =>
  number(
    conditions(resolve(outline, new Map([[id('calib'), contributionsOf(content)]]))),
    defaultNumberingScheme,
  );

describe('the resolution order, each adjacent pair of stages that exists', () => {
  it('PUB-098 resolves each occurrence before any condition runs: a condition is handed resolved content, and the types refuse it an occurrence not yet resolved', () => {
    const handed: [string, ContentDocument][] = [];
    assemble(
      input({
        conditionContent: (node, content) => {
          handed.push([node, content]);
          return content;
        },
      }),
    );
    // What resolution made: the occurrence's content, by its node.
    expect(handed).toEqual([[id('calib'), stored]]);
    expect(handed[0]![1]).toBe(stored);
    // Swapped, a condition would be handed the occurrence as the outline holds it before resolution:
    // a component and a mode, with no content to condition. The types refuse it.
    const occurrence = outline.nodes[0]!.children[0] as ReferenceNode;
    const condition = input().conditionContent!;
    const swapped = () =>
      // @ts-expect-error - an outline's reference is not an occurrence's resolved content.
      condition(occurrence.id, occurrence);
    expect(typeof swapped).toBe('function');
  });

  it('PUB-098 applies conditions before contributions: counted from the content as stored, a table a condition hides takes a number and moves the next', () => {
    const made = assemble(input());
    if (!made.ok) throw new Error(JSON.stringify(made.failures));
    // In order: counted from what survives, the hidden table takes no number.
    expect(tableLabels(made.numbering)).toEqual({ t2: 'Table 1.1', t3: 'Table 1.2' });
    expect(made.numbering).toEqual(numbered(hiding(id('calib'), stored)));
    // Swapped: counted from the stored content, then conditioned - the hidden table is numbered and
    // every table after it is one out.
    expect(tableLabels(numbered(stored))).toEqual({
      t1: 'Table 1.1',
      t2: 'Table 1.2',
      t3: 'Table 1.3',
    });
  });

  it("PUB-098 counts contributions before numbering: numbered before they are counted, no table takes a number, and `number` refuses at compile time what has not been through the outline's conditions", () => {
    const content = hiding(id('calib'), stored);
    const inOrder = numbered(content);
    // Swapped: the outline numbered with nothing yet counted for its occurrence - the only way to
    // number first, since `resolve` wants what each occurrence contributes - and counted after.
    const early = number(conditions(resolve(outline, new Map())), defaultNumberingScheme);
    contributionsOf(content);
    expect(tableLabels(inOrder)).toEqual({ t2: 'Table 1.1', t3: 'Table 1.2' });
    expect(tableLabels(early)).toEqual({});
    // And the product numbers in order: what `assemble` publishes is the numbering counted first.
    const made = assemble(input());
    if (!made.ok) throw new Error(JSON.stringify(made.failures));
    expect(tableLabels(made.numbering)).toEqual(tableLabels(inOrder));
    // And the outline's own condition stage, which `number` reads the contributions through, cannot
    // be skipped or come after it: a `Resolved` is not the `Conditioned` that `number` takes.
    const unconditioned = resolve(outline, new Map([[id('calib'), contributionsOf(content)]]));
    const skipped = () =>
      // @ts-expect-error - `number` takes only what has been through the outline's conditions.
      number(unconditioned, defaultNumberingScheme);
    expect(typeof skipped).toBe('function');
  });

  it('PUB-098 numbers before resolving references: resolved against a numbering not yet made, a reference to a table has no number to print', () => {
    const made = assemble(input());
    if (!made.ok) throw new Error(JSON.stringify(made.failures));
    const conditioned = new Map([[id('calib'), hiding(id('calib'), stored)]]);
    const target = { kind: 'block', block: 't2' } as const;
    const inOrder = referenceResolver({
      outline,
      occurrences: conditioned,
      numbering: made.numbering,
    });
    // Swapped: nothing is numbered yet, so the numbering the references read is empty.
    const early = referenceResolver({
      outline,
      occurrences: conditioned,
      numbering: { scheme: defaultNumberingScheme.id, entries: [] },
    });
    expect(inOrder(target, { node: id('calib') })).toMatchObject({
      ok: true,
      target: { label: 'Table 1.1' },
    });
    expect(early(target, { node: id('calib') })).toMatchObject({
      ok: true,
      target: { label: null },
    });
    // And what the publication prints is the numbered one.
    const paragraph = blocksOf(made.document.nodes).find(
      (block) => block.type === 'paragraph' && printed(block.runs).startsWith('See '),
    );
    expect(paragraph?.type === 'paragraph' && printed(paragraph.runs)).toBe('See Table 1.1');
  });

  it('PUB-098 resolves references before generating the lists: generated first, a caption holding a reference lists without its number', () => {
    const made = assemble(input());
    if (!made.ok) throw new Error(JSON.stringify(made.failures));
    // In order: a list of tables sets each table's caption as it is published, its reference
    // resolved - what the template's list reads.
    const captions = blocksOf(made.document.nodes).flatMap((block) =>
      block.type === 'table' ? [printed(block.caption)] : [],
    );
    expect(captions).toEqual(['Pressures', 'Readings after Table 1.1']);
    expect(made.document.front.lists.map((list) => list.sequence)).toContain('table');
    // Swapped: generated from what exists before references resolve - the conditioned outline, its
    // numbering and each caption's words - the reference is not yet anything to print.
    const conditioned = conditions(
      resolve(outline, new Map([[id('calib'), contributionsOf(hiding(id('calib'), stored))]])),
    );
    expect(listOf(conditioned, made.numbering, 'table').map((entry) => entry.caption)).toEqual([
      'Pressures',
      'Readings after ',
    ]);
  });

  it('PUB-098 generates before the check that reads it: a declared contents that generates no entry is checked as none, and a document with nothing else is refused', () => {
    // No cover, a contents to three levels declared, and no node: before generation, a check could
    // read only the declaration, which promises a contents, and would pass an empty artifact.
    const bare = parseLayout({
      ...defaultLayout,
      matter: { ...defaultLayout.matter, cover: false },
    });
    expect(bare.matter.contents).not.toBeNull();
    const empty = parseOutlineDocument({ ...outline, nodes: [] });
    const generated = contents(
      conditions(resolve(empty, new Map())),
      { scheme: 'x', entries: [] },
      3,
    );
    expect(generated).toEqual([]);
    // In order, the check reads what generation made, and refuses.
    const made = assemble(input({ layout: bare, outline: empty, occurrences: new Map() }));
    expect(made).toMatchObject({ ok: false, failures: [{ code: 'nothing_to_publish' }] });
  });

  it('PUB-098 returns a projection only where every check passed: a document that fails one is never projected, and the types give a refused assembly no document to read', () => {
    // A character no face here sets: the glyph check fails the document.
    const made = assemble(input({ covers: (codePoint) => codePoint !== 0x59 }));
    expect(made.ok).toBe(false);
    if (made.ok) return;
    expect(made.failures.map((each) => each.code)).toContain('glyph_missing');
    expect('document' in made).toBe(false);
    // Swapped, the projection would be made before anything was checked and could be read from a
    // refused assembly; the types have none on that branch.
    const read = () =>
      // @ts-expect-error - a refused assembly carries no published document.
      made.document;
    expect(read()).toBeUndefined();
  });
});
