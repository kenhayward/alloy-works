import { describe, expect, it } from 'vitest';

import type { ContentDocument } from '../model/document.js';

import { reidentify, type Receiver } from './reidentify.js';
import { createReport } from './report.js';

const document: ContentDocument = {
  schemaVersion: 1,
  title: 'Site visits',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    {
      type: 'paragraph',
      id: 'n1',
      style: 'body',
      content: [{ type: 'text', value: 'Leeds', marks: [{ type: 'strong', id: 'n2' }] }],
    },
  ],
};

/** Hands out n1, n2, n3... in order, so a test can see which identifiers were drawn again. */
const counter = (): (() => string) => {
  let next = 0;
  return () => `n${(next += 1)}`;
};

const receiver = (overrides: Partial<Receiver> = {}): Receiver => ({
  document,
  conditionAxes: [],
  newIdentifier: counter(),
  ...overrides,
});

const text = (value: string, marks: unknown[] = []) => ({ type: 'text', value, marks });
const paragraph = (id: string | undefined, content: unknown[]) => ({
  type: 'paragraph',
  ...(id === undefined ? {} : { id }),
  style: 'body',
  content,
});
const reference = (id: string, target: unknown) => ({
  type: 'crossReference',
  id,
  target,
  display: 'number',
});
const figure = (id: string, asset: string, caption: string) => ({
  type: 'figure',
  id,
  asset,
  imageStyle: 'column-width',
  caption,
  alternative: { kind: 'decorative' },
});
const footnote = (id: string, content: unknown[]) => ({
  type: 'footnote',
  id,
  anchor: { kind: 'span' },
  content,
});

const run = (candidate: Record<string, unknown>, to: Receiver = receiver()) => {
  const report = createReport();
  const identified = reidentify(candidate, to, report);
  // What was renamed is asserted through `admit`, which hands it on; these assert the content.
  const outcome = identified.ok ? { ok: true, value: identified.value } : identified;
  return { outcome, entries: report.entries.map(({ message: _, ...entry }) => entry) };
};

describe('the re-identify stage', () => {
  it('gives every block a new identifier, skipping those the receiving component holds', () => {
    const { outcome, entries } = run({
      schemaVersion: 1,
      content: [paragraph('n1', [text('Copied')]), paragraph(undefined, [text('Foreign')])],
    });
    expect(outcome).toEqual({
      ok: true,
      value: {
        schemaVersion: 1,
        content: [paragraph('n3', [text('Copied')]), paragraph('n4', [text('Foreign')])],
      },
    });
    expect(entries).toEqual([
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 2 },
    ]);
  });

  it('reaches blocks inside lists, tables, quotations and footnotes', () => {
    const { outcome, entries } = run({
      schemaVersion: 1,
      content: [
        {
          type: 'list',
          id: 'old-list',
          kind: 'unordered',
          items: [{ content: [paragraph('old-item', [text('Item')])] }],
        },
        {
          type: 'table',
          id: 'old-table',
          caption: [{ type: 'text', value: 'Sites', marks: [] }],
          headerRows: 0,
          headerColumns: 0,
          note: [text('Note')],
          rows: [
            {
              cells: [{ content: [paragraph('old-cell', [text('York')])], colspan: 1, rowspan: 1 }],
            },
          ],
        },
        {
          type: 'blockquote',
          id: 'old-quote',
          content: [
            paragraph('old-quoted', [
              {
                type: 'footnote',
                id: 'old-note',
                anchor: { kind: 'span' },
                content: [paragraph('old-note-paragraph', [text('Source')])],
              },
            ]),
          ],
          attribution: [text('Ada')],
        },
      ],
    });
    const ids: string[] = [];
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(collect);
      if (typeof value !== 'object' || value === null) return;
      const record = value as Record<string, unknown>;
      if (typeof record.id === 'string') ids.push(record.id);
      Object.values(record).forEach(collect);
    };
    collect(outcome.ok ? outcome.value : undefined);
    expect(ids).toEqual(['n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9', 'n10']);
    // Eight blocks: the list, its item's paragraph, the table, its cell's paragraph, the
    // blockquote, its paragraph, the footnote and the footnote's paragraph. No text in this
    // fixture carries a mark, so no markIdentifier entry is reported.
    expect(entries).toEqual([
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 8 },
    ]);
  });

  it("re-identifies a definition item's term, marks and cross-references alike", () => {
    // The list branch is the one place a block's inline content is reached through an item rather
    // than through a member of the block itself, so a term left out of it kept BOTH halves of what
    // this stage exists to rewrite: a pasted mark's identifier survived into the receiving
    // component, where it may already name an annotation (CNT-132), and a pasted cross-reference
    // kept both its own identifier and a target naming a block that no longer exists after the
    // copy - a reference dangling the moment it arrives.
    const { outcome, entries } = run({
      schemaVersion: 1,
      content: [
        {
          type: 'list',
          id: 'old-list',
          kind: 'definition',
          items: [
            {
              term: [
                text('Tensile strength', [{ type: 'emphasis', id: 'old-mark' }]),
                reference('old-x1', { kind: 'block', block: 'old-item' }),
              ],
              content: [paragraph('old-item', [text('The stress it bears.')])],
            },
          ],
        },
      ],
    });
    expect(outcome).toEqual({
      ok: true,
      value: {
        schemaVersion: 1,
        content: [
          {
            type: 'list',
            id: 'n3',
            kind: 'definition',
            items: [
              {
                term: [
                  text('Tensile strength', [{ type: 'emphasis', id: 'n4' }]),
                  // Its own identifier rewritten, and its target pointing at the copy of the
                  // paragraph that travelled with it rather than at the identifier it arrived with.
                  reference('n5', { kind: 'block', block: 'n6' }),
                ],
                content: [paragraph('n6', [text('The stress it bears.')])],
              },
            ],
          },
        ],
      },
    });
    expect(entries).toEqual([
      // Three: the list, the cross-reference in its term, and the item's paragraph.
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 3 },
      { stage: 'reidentify', action: 'rewritten', subject: 'crossReferenceTarget', count: 1 },
      { stage: 'reidentify', action: 'rewritten', subject: 'markIdentifier', count: 1 },
    ]);
  });

  it('gives a cross-reference a new identifier, and points one at the copy of what it refers to', () => {
    const component = '7c2e9b41-3a6d-4f18-8e05-1d9a4c6b8f27';
    const dose = figure('old-figure', '00000000-0000-4000-8000-00000000a551', 'Dose');
    const { outcome, entries } = run({
      schemaVersion: 1,
      content: [
        // The references come before the figure they point at, so pointing them is a second pass.
        paragraph('old-paragraph', [
          text('See '),
          reference('old-x1', { kind: 'block', block: 'old-figure' }),
          reference('old-x2', { kind: 'block', block: 'not-copied' }),
          reference('old-x3', { kind: 'component', component, block: 'old-figure' }),
        ]),
        dose,
      ],
    });
    expect(outcome).toEqual({
      ok: true,
      value: {
        schemaVersion: 1,
        content: [
          paragraph('n3', [
            text('See '),
            // Its block travelled with it, so it points at the copy.
            reference('n4', { kind: 'block', block: 'n7' }),
            // Its block did not travel: left as it stands, for resolution to name as missing.
            reference('n5', { kind: 'block', block: 'not-copied' }),
            // Another component's block: nothing here renames another component's identifiers.
            reference('n6', { kind: 'component', component, block: 'old-figure' }),
          ]),
          { ...dose, id: 'n7' },
        ],
      },
    });
    expect(entries).toEqual([
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 5 },
      { stage: 'reidentify', action: 'rewritten', subject: 'crossReferenceTarget', count: 1 },
      // The component target isn't counted (nothing here renames another component's
      // identifiers), so only old-x2 - the untravelled block target - is left standing.
      { stage: 'reidentify', action: 'kept', subject: 'crossReferenceUnresolved', count: 1 },
    ]);
  });

  it('points a reference inside a footnote at a copy travelling in the body, and the reverse', () => {
    const dose = figure('old-figure', '00000000-0000-4000-8000-00000000a551', 'Dose');
    const { outcome, entries } = run({
      schemaVersion: 1,
      content: [
        paragraph('old-paragraph', [
          text('See '),
          footnote('old-note', [
            // A reference inside a footnote, naming a block that travels in the body.
            paragraph('old-note-paragraph', [
              reference('old-x1', { kind: 'block', block: 'old-figure' }),
            ]),
          ]),
        ]),
        dose,
      ],
    });
    expect(outcome).toEqual({
      ok: true,
      value: {
        schemaVersion: 1,
        content: [
          paragraph('n3', [
            text('See '),
            footnote('n4', [paragraph('n5', [reference('n6', { kind: 'block', block: 'n7' })])]),
          ]),
          { ...dose, id: 'n7' },
        ],
      },
    });
    expect(entries).toEqual([
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 5 },
      { stage: 'reidentify', action: 'rewritten', subject: 'crossReferenceTarget', count: 1 },
    ]);
  });

  it('does not repoint a reference to an identifier that arrived on two blocks, leaving it to resolve as missing', () => {
    const one = figure('fig', '00000000-0000-4000-8000-00000000a551', 'One');
    const two = figure('fig', '00000000-0000-4000-8000-00000000a552', 'Two');
    const { outcome, entries } = run({
      schemaVersion: 1,
      content: [
        paragraph('old-paragraph', [
          text('See '),
          reference('old-x1', { kind: 'block', block: 'fig' }),
        ]),
        one,
        two,
      ],
    });
    expect(outcome).toEqual({
      ok: true,
      value: {
        schemaVersion: 1,
        content: [
          paragraph('n3', [
            text('See '),
            // Ambiguous - two blocks arrived with the same old identifier - so it is left standing
            // rather than guessed, exactly as an untravelled target is (decision F).
            reference('n4', { kind: 'block', block: 'fig' }),
          ]),
          { ...one, id: 'n5' },
          { ...two, id: 'n6' },
        ],
      },
    });
    expect(entries).toEqual([
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 4 },
      { stage: 'reidentify', action: 'kept', subject: 'crossReferenceUnresolved', count: 1 },
    ]);
  });

  it('does not repoint a reference to an identifier a footnote and a block both arrived with', () => {
    const dose = figure('fig', '00000000-0000-4000-8000-00000000a551', 'Dose');
    const { outcome, entries } = run({
      schemaVersion: 1,
      content: [
        paragraph('old-paragraph', [
          text('See '),
          reference('old-x1', { kind: 'block', block: 'fig' }),
          footnote('fig', [paragraph('old-note-paragraph', [text('Note')])]),
        ]),
        dose,
      ],
    });
    expect(outcome).toEqual({
      ok: true,
      value: {
        schemaVersion: 1,
        content: [
          paragraph('n3', [
            text('See '),
            reference('n4', { kind: 'block', block: 'fig' }),
            footnote('n5', [paragraph('n6', [text('Note')])]),
          ]),
          { ...dose, id: 'n7' },
        ],
      },
    });
    expect(entries).toEqual([
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 5 },
      { stage: 'reidentify', action: 'kept', subject: 'crossReferenceUnresolved', count: 1 },
    ]);
  });

  it('never allocates an identifier equal to a target a reference still names, so a coincidence cannot silently repoint it', () => {
    const offered = ['not-copied', 'n9', 'n10'];
    let next = 0;
    const { outcome, entries } = run(
      {
        schemaVersion: 1,
        content: [
          paragraph('old-paragraph', [reference('old-x1', { kind: 'block', block: 'not-copied' })]),
        ],
      },
      receiver({ newIdentifier: () => offered[next++] ?? `spare${next}` }),
    );
    expect(outcome).toEqual({
      ok: true,
      value: {
        schemaVersion: 1,
        content: [
          // Without the reservation, the paragraph would have been allocated 'not-copied' itself -
          // the very string its own reference still names - silently making the reference point at
          // an unrelated block that happens to share that new identifier.
          paragraph('n9', [reference('n10', { kind: 'block', block: 'not-copied' })]),
        ],
      },
    });
    expect(entries).toEqual([
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 2 },
      { stage: 'reidentify', action: 'kept', subject: 'crossReferenceUnresolved', count: 1 },
    ]);
  });

  it('never allocates an identifier the receiving component still names in a reference, though its block is gone', () => {
    // The receiver's own sentence cites a figure since deleted: n3, as the counter would draw next.
    const citing: ContentDocument = {
      ...document,
      content: [
        {
          type: 'paragraph',
          id: 'n1',
          style: 'body',
          content: [
            { type: 'text', value: 'See ', marks: [{ type: 'strong', id: 'n2' }] },
            {
              type: 'crossReference',
              id: 'r1',
              target: { kind: 'block', block: 'n3' },
              display: 'number',
            },
          ],
        },
      ],
    };
    const dose = figure('old-figure', '00000000-0000-4000-8000-00000000a551', 'Dose');
    const { outcome } = run({ schemaVersion: 1, content: [dose] }, receiver({ document: citing }));
    // Given n3, the pasted figure would silently become what the receiver's reference resolves to.
    expect(outcome).toEqual({
      ok: true,
      value: { schemaVersion: 1, content: [{ ...dose, id: 'n4' }] },
    });
  });

  it('says nothing of a reference left standing whose target the receiving component holds', () => {
    // A sentence copied within one component: the figure it cites stayed where it was, so the copy
    // resolves exactly as the original does, and telling the author it did not arrive would be false.
    const holding: ContentDocument = {
      ...document,
      content: [
        ...document.content,
        {
          type: 'figure',
          id: 'fig',
          asset: '00000000-0000-4000-8000-00000000a551',
          imageStyle: 'column-width',
          caption: [{ type: 'text', value: 'Dose', marks: [] }],
          alternative: { kind: 'decorative' },
        },
      ],
    };
    const copied = (block: string) =>
      run(
        {
          schemaVersion: 1,
          content: [paragraph('old-paragraph', [reference('old-x1', { kind: 'block', block })])],
        },
        receiver({ document: holding }),
      ).entries;
    expect(copied('fig')).toEqual([
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 2 },
    ]);
    // Held by the receiver as something else - a mark's identifier - is not held as a target.
    expect(copied('n2')).toEqual([
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 2 },
      { stage: 'reidentify', action: 'kept', subject: 'crossReferenceUnresolved', count: 1 },
    ]);
  });

  it('gives every mark a new identifier, and the fragments of one annotation one between them', () => {
    const { outcome, entries } = run({
      schemaVersion: 1,
      content: [
        paragraph('b', [
          text('One ', [
            { type: 'emphasis', id: 'm1' },
            { type: 'language', id: 'm2', tag: 'fr-FR' },
          ]),
          text('two', [{ type: 'emphasis', id: 'm1' }]),
          text('three', [{ type: 'strong' }]),
        ]),
      ],
    });
    expect(outcome).toEqual({
      ok: true,
      value: {
        schemaVersion: 1,
        content: [
          paragraph('n3', [
            text('One ', [
              { type: 'emphasis', id: 'n4' },
              { type: 'language', id: 'n5', tag: 'fr-FR' },
            ]),
            text('two', [{ type: 'emphasis', id: 'n4' }]),
            text('three', [{ type: 'strong', id: 'n6' }]),
          ]),
        ],
      },
    });
    expect(entries).toEqual([
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
      { stage: 'reidentify', action: 'rewritten', subject: 'markIdentifier', count: 3 },
    ]);
  });

  it('does not merge two marks of different types that arrive with one identifier', () => {
    const { outcome, entries } = run({
      schemaVersion: 1,
      content: [
        paragraph('b', [
          text('x', [
            { type: 'emphasis', id: 'same' },
            { type: 'strong', id: 'same' },
          ]),
        ]),
      ],
    });
    expect(outcome.ok && outcome.value.content).toEqual([
      paragraph('n3', [
        text('x', [
          { type: 'emphasis', id: 'n4' },
          { type: 'strong', id: 'n5' },
        ]),
      ]),
    ]);
    // One block (the paragraph); two marks, because the same arriving identifier on two
    // different types is two annotations, not one.
    expect(entries).toEqual([
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
      { stage: 'reidentify', action: 'rewritten', subject: 'markIdentifier', count: 2 },
    ]);
  });

  it('drops comments and suggestions, one entry for each annotation however many runs it covers', () => {
    const { outcome, entries } = run({
      schemaVersion: 1,
      content: [
        paragraph('b', [
          text('Kept ', [{ type: 'comment', id: 'c1', threadId: 't1' }]),
          text('text', [
            { type: 'comment', id: 'c1', threadId: 't1' },
            { type: 'suggestion', id: 's1', operation: 'delete', author: 'Grace' },
          ]),
        ]),
      ],
    });
    expect(outcome.ok && outcome.value.content).toEqual([
      paragraph('n3', [text('Kept ', []), text('text', [])]),
    ]);
    expect(entries).toEqual([
      { stage: 'reidentify', action: 'discarded', subject: 'comment' },
      { stage: 'reidentify', action: 'discarded', subject: 'suggestion' },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
    ]);
  });

  it('drops a condition whose axis the space lacks, and keeps one whose axis it has', () => {
    const { outcome, entries } = run(
      {
        schemaVersion: 1,
        content: [
          paragraph('b', [
            text('UK only', [
              { type: 'condition', id: 'k1', axis: 'jurisdiction', values: ['uk'] },
            ]),
            text('Vets only', [
              { type: 'condition', id: 'k2', axis: 'audience', values: ['vets'] },
            ]),
          ]),
        ],
      },
      receiver({ conditionAxes: ['audience'] }),
    );
    expect(outcome.ok && outcome.value.content).toEqual([
      paragraph('n3', [
        text('UK only', []),
        text('Vets only', [{ type: 'condition', id: 'n4', axis: 'audience', values: ['vets'] }]),
      ]),
    ]);
    expect(entries).toEqual([
      { stage: 'reidentify', action: 'discarded', subject: 'condition', detail: 'jurisdiction' },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
      { stage: 'reidentify', action: 'rewritten', subject: 'markIdentifier', count: 1 },
    ]);
  });

  it('refuses when the allocator keeps returning identifiers already used', () => {
    const { outcome, entries } = run(
      { schemaVersion: 1, content: [paragraph('b', [text('x')])] },
      receiver({ newIdentifier: () => 'n1' }),
    );
    expect(outcome).toEqual({
      ok: false,
      failure: '8 identifiers in a row were empty or already used in the receiving component',
    });
    expect(entries).toEqual([{ stage: 'reidentify', action: 'refused', subject: 'identifiers' }]);
  });

  it("refuses, the same way, when the caller's allocator throws instead of returning", () => {
    const { outcome, entries } = run(
      { schemaVersion: 1, content: [paragraph('b', [text('x')])] },
      receiver({
        newIdentifier: () => {
          throw new Error('the identity plugin is not ready');
        },
      }),
    );
    expect(outcome).toEqual({
      ok: false,
      failure: '8 identifiers in a row were empty or already used in the receiving component',
    });
    expect(entries).toEqual([{ stage: 'reidentify', action: 'refused', subject: 'identifiers' }]);
  });
});
