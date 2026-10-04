import type { ContentDocument, Mark } from '@alloy-works/domain';
import { undo } from 'prosemirror-history';
import { TextSelection, type EditorState } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';

import {
  PRODUCT_CLIPBOARD_TYPE,
  pasteInto,
  productClipboard,
  readClipboard,
  readMarkdownText,
  type ClipboardSource,
} from './clipboard.js';
import { fromEditor, toEditor } from './mapping.js';
import { createEditorState } from './state.js';

const counter = (prefix = 'n') => {
  let next = 0;
  return () => `${prefix}${(next += 1)}`;
};

function stateOf(content: ContentDocument['content'], newIdentifier = counter()): EditorState {
  const opened = toEditor({
    schemaVersion: 1,
    title: 'Site visits',
    language: 'en-GB',
    direction: 'ltr',
    content,
  });
  if (!opened.editable) throw new Error('expected an editable document');
  return createEditorState({ doc: opened.doc, newIdentifier });
}

const paragraph = (id: string, value: string, marks: Mark[] = []) => ({
  type: 'paragraph' as const,
  id,
  style: 'body',
  content: value === '' ? [] : [{ type: 'text' as const, value, marks }],
});

/** A clipboard holding exactly these types, as a paste event's `clipboardData` does. */
const clipboard = (data: Record<string, string>): ClipboardSource => ({
  types: Object.keys(data),
  getData: (type) => data[type] ?? '',
});

/** Pastes into the state and answers the state afterwards, or fails the test saying why not. */
function paste(state: EditorState, data: Record<string, string>): EditorState {
  const into = state.selection.$from.parent.type.spec.code ? 'preformatted' : 'blocks';
  const outcome = pasteInto(state, readClipboard(clipboard(data), into), counter('p'));
  if (!outcome.ok) throw new Error(outcome.report.at(-1)?.message);
  return state.apply(outcome.transaction);
}

const stored = (state: EditorState) => fromEditor(state.doc).content;

const at = (state: EditorState, pos: number) =>
  state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));

describe('pasting', () => {
  it('pastes lines of plain text, joining the first and last to the text around the caret', () => {
    // After "York " in "York Leeds".
    const state = paste(at(stateOf([paragraph('b1', 'York Leeds')]), 6), {
      'text/plain': 'and\nHull ',
    });
    // The receiving paragraph keeps its identifier, and what followed the caret is the last pasted
    // block, under the name admission gave it: a paste keeps what admission named (cross-references
    // 1, ruling R8), where footnotes 1 had the identity plugin name it again as a split's second half.
    expect(stored(state)).toEqual([paragraph('b1', 'York and'), paragraph('p2', 'Hull Leeds')]);
  });

  it('pastes HTML with its structure, a list staying a list', () => {
    const state = paste(stateOf([paragraph('b1', '')]), {
      'text/html': '<ul><li>One</li><li><b>Two</b></li></ul>',
      'text/plain': 'One\nTwo',
    });
    expect(stored(state)).toMatchObject([
      {
        type: 'list',
        kind: 'unordered',
        items: [
          { content: [{ type: 'paragraph', content: [{ value: 'One' }] }] },
          {
            content: [
              { type: 'paragraph', content: [{ value: 'Two', marks: [{ type: 'strong' }] }] },
            ],
          },
        ],
      },
    ]);
  });

  it("pastes Word's footnote as a footnote, holding its note, where its mark stood (issue #254)", () => {
    // Word's shape, as its clipboard carries it: the anchor in the text naming its note, and the
    // note after the text in Word's list of notes, opening with a link back.
    const html = `<p class=MsoNormal>Unbox it<a style='mso-footnote-id:ftn1' href="#_ftn1" name="_ftnref1"><span class=MsoFootnoteReference>[1]</span></a> now.</p>
<div style='mso-element:footnote-list'><div style='mso-element:footnote' id=ftn1>
<p class=MsoFootnoteText><a style='mso-footnote-id:ftn1' href="#_ftnref1" name="_ftn1"><span class=MsoFootnoteReference>[1]</span></a> Keep the <b>box</b>.</p>
</div></div>`;
    const state = paste(stateOf([paragraph('b1', '')]), { 'text/html': html });
    expect(stored(state)).toMatchObject([
      {
        type: 'paragraph',
        content: [
          { type: 'text', value: 'Unbox it' },
          {
            type: 'footnote',
            anchor: { kind: 'span' },
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', value: 'Keep the ' },
                  { type: 'text', value: 'box', marks: [{ type: 'strong' }] },
                  { type: 'text', value: '.' },
                ],
              },
            ],
          },
          { type: 'text', value: ' now.' },
        ],
      },
    ]);
  });

  it("reads the product's own type before HTML, and HTML before plain text", () => {
    const source = stateOf([paragraph('s1', 'Bold', [{ type: 'strong', id: 's2' }])]);
    const copied = productClipboard(source, 0, source.doc.content.size);
    expect(copied).toBeDefined();
    const state = paste(stateOf([paragraph('b1', '')]), {
      [PRODUCT_CLIPBOARD_TYPE]: copied!,
      'text/html': '<p>From HTML</p>',
      'text/plain': 'From text',
    });
    expect(stored(state)).toMatchObject([
      { type: 'paragraph', content: [{ value: 'Bold', marks: [{ type: 'strong' }] }] },
    ]);
    expect(
      stored(
        paste(stateOf([paragraph('b1', '')]), {
          'text/html': '<p>From HTML</p>',
          'text/plain': 'x',
        }),
      ),
    ).toMatchObject([{ content: [{ value: 'From HTML' }] }]);
  });

  it('gives what it pastes new identifiers, never the ones it was copied with', () => {
    const source = stateOf([
      paragraph('s1', 'One', [{ type: 'emphasis', id: 's2' }]),
      paragraph('s3', 'Two'),
    ]);
    const copied = productClipboard(source, 0, source.doc.content.size)!;
    // Pasted back into the component it came from, at its end: nothing may keep a copied identifier.
    const state = paste(at(source, source.doc.content.size - 1), {
      [PRODUCT_CLIPBOARD_TYPE]: copied,
    });
    const ids = JSON.stringify(stored(state)).match(/"id":"[^"]+"/g)!;
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps pasted text exactly in preformatted text, reading only its plain text', () => {
    const opened = stateOf([{ type: 'preformatted', id: 'b1', text: 'a\n' }]);
    const state = paste(at(opened, 2), {
      'text/html': '<p>not this</p>',
      'text/plain': '\tb\r\n  c',
    });
    expect(stored(state)).toEqual([{ type: 'preformatted', id: 'b1', text: 'a\tb\n  c\n' }]);
  });

  it('takes a paste back with one undo', () => {
    const before = stateOf([paragraph('b1', 'York')]);
    const pasted = paste(at(before, 5), { 'text/html': '<p> and</p><p>Leeds</p>' });
    let undone = pasted;
    undo(pasted, (transaction) => (undone = pasted.apply(transaction)));
    expect(stored(undone)).toEqual([paragraph('b1', 'York')]);
  });

  it('refuses a clipboard nothing can be read from, changing nothing and saying why', () => {
    const state = stateOf([paragraph('b1', 'York')]);
    const outcome = pasteInto(
      state,
      readClipboard(clipboard({ 'image/png': 'x' }), 'blocks'),
      counter(),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.report.at(-1)).toMatchObject({ action: 'refused', subject: 'unreadable' });
  });

  it('refuses what the pipeline admits and this editor cannot hold, by name', () => {
    // A citation: every block has a node since equations 1, and a citation is among the inline
    // nodes the editor still has none for.
    const cited = JSON.stringify({
      format: 'alloy-works/content',
      schemaVersion: 1,
      content: [
        {
          type: 'paragraph',
          style: 'body',
          content: [{ type: 'citation', entry: 'ada-1843' }],
        },
      ],
    });
    const outcome = pasteInto(
      stateOf([paragraph('b1', 'York')]),
      readClipboard(clipboard({ [PRODUCT_CLIPBOARD_TYPE]: cited }), 'blocks'),
      counter(),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.report.slice(-2)).toMatchObject([
      { action: 'discarded', subject: 'unrepresentable', detail: 'citation' },
      { action: 'refused', subject: 'invalid' },
    ]);
  });

  it('keeps the rest of the paragraph out of a pasted table, rather than in its last cell', () => {
    const table = {
      type: 'table',
      style: 'table',
      caption: [],
      headerRows: 0,
      headerColumns: 0,
      rows: [{ cells: [{ content: [paragraph('c1', 'Cell')], colspan: 1, rowspan: 1 }] }],
    };
    const outcome = pasteInto(
      stateOf([paragraph('b1', 'York')]),
      readClipboard(
        clipboard({
          [PRODUCT_CLIPBOARD_TYPE]: JSON.stringify({
            format: 'alloy-works/content',
            schemaVersion: 1,
            content: [table],
          }),
        }),
        'blocks',
      ),
      counter(),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.transaction.doc.textContent).toBe('CellYork');
    const pasted = fromEditor(outcome.transaction.doc).content.find(
      (block) => block.type === 'table',
    ) as { rows: { cells: { content: unknown[] }[] }[] };
    expect(pasted.rows[0]!.cells[0]!.content).toMatchObject([{ content: [{ value: 'Cell' }] }]);
  });

  it('keeps an inline image copied within the product, in the run it was copied in', () => {
    // Figures 4, ruling R8: the product's own clipboard carries an image in a run, as it does a figure.
    const image = {
      type: 'image',
      asset: '00000000-0000-4000-8000-00000000a551',
      imageStyle: 'inline',
      alternative: { kind: 'own', text: 'Our logo' },
    };
    const pasted = paste(at(stateOf([paragraph('b1', 'York')]), 5), {
      [PRODUCT_CLIPBOARD_TYPE]: JSON.stringify({
        format: 'alloy-works/content',
        schemaVersion: 1,
        content: [
          {
            type: 'paragraph',
            id: 'x1',
            style: 'body',
            content: [{ type: 'text', value: 'Press ', marks: [] }, image],
          },
        ],
      }),
    });
    expect(stored(pasted)).toEqual([
      {
        type: 'paragraph',
        id: 'b1',
        style: 'body',
        content: [{ type: 'text', value: 'YorkPress ', marks: [] }, image],
      },
    ]);
  });

  it('keeps a figure copied within the product, its image, caption and alternative text and all', () => {
    // Figures 2: the product's own clipboard carries a figure whole (component-editor.md, "Figures").
    const figure = {
      type: 'figure',
      asset: '00000000-0000-4000-8000-00000000a551',
      imageStyle: 'figure',
      caption: [{ type: 'text', value: 'Visits', marks: [] }],
      alternative: { kind: 'own', text: 'Two red squares' },
    };
    const outcome = pasteInto(
      stateOf([paragraph('b1', 'York')]),
      readClipboard(
        clipboard({
          [PRODUCT_CLIPBOARD_TYPE]: JSON.stringify({
            format: 'alloy-works/content',
            schemaVersion: 1,
            content: [figure],
          }),
        }),
        'blocks',
      ),
      counter(),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const pasted = fromEditor(outcome.transaction.doc).content.find(
      (block) => block.type === 'figure',
    );
    expect(pasted).toMatchObject({
      asset: figure.asset,
      caption: figure.caption,
      alternative: figure.alternative,
    });
  });

  describe('a figure or a table marked unnumbered (issue #129)', () => {
    const caption = (value: string) => [{ type: 'text' as const, value, marks: [] }];
    const table = {
      type: 'table' as const,
      id: 's1',
      style: 'table',
      caption: caption('Layout only'),
      headerRows: 0,
      headerColumns: 0,
      numbered: false as const,
      rows: [{ cells: [{ content: [paragraph('s2', 'Cell')], colspan: 1, rowspan: 1 }] }],
    };
    const figure = {
      type: 'figure' as const,
      id: 's3',
      asset: '00000000-0000-4000-8000-00000000a551',
      imageStyle: 'figure',
      caption: caption('Decoration'),
      alternative: { kind: 'decorative' as const },
      numbered: false as const,
    };

    it('keeps them unnumbered through a copy and a paste within the product', () => {
      const source = stateOf([table, figure]);
      const copied = productClipboard(source, 0, source.doc.content.size)!;
      const pasted = stored(
        paste(stateOf([paragraph('b1', '')]), { [PRODUCT_CLIPBOARD_TYPE]: copied }),
      );
      expect(pasted.filter((block) => block.type !== 'paragraph')).toMatchObject([
        { type: 'table', caption: table.caption, numbered: false },
        { type: 'figure', caption: figure.caption, numbered: false },
      ]);
    });

    it("refuses one the product's own type spells numbered: true, which the store would not take", () => {
      const outcome = pasteInto(
        stateOf([paragraph('b1', 'York')]),
        readClipboard(
          clipboard({
            [PRODUCT_CLIPBOARD_TYPE]: JSON.stringify({
              format: 'alloy-works/content',
              schemaVersion: 1,
              content: [{ ...figure, numbered: true }],
            }),
          }),
          'blocks',
        ),
        counter(),
      );
      expect(outcome.ok).toBe(false);
    });

    it('pastes a table from HTML numbered, the member absent, since nothing outside says otherwise', () => {
      const pasted = stored(
        paste(stateOf([paragraph('b1', '')]), {
          'text/html': '<table><caption>Prices</caption><tr><td>1</td></tr></table>',
        }),
      );
      const found = pasted.find((block) => block.type === 'table');
      expect(found).toMatchObject({ caption: caption('Prices') });
      expect(found).not.toHaveProperty('numbered');
    });
  });
});

describe('pasting into a table', () => {
  it('refuses a paste that would put a quotation in a list in a cell, which the store would not take', () => {
    const state = stateOf([
      {
        type: 'table',
        id: 't1',
        style: 'table',
        caption: [],
        headerRows: 0,
        headerColumns: 0,
        rows: [
          {
            cells: [
              {
                content: [
                  {
                    type: 'list',
                    id: 'l1',
                    kind: 'unordered',
                    items: [{ content: [paragraph('li1', 'one')] }],
                  },
                ],
                colspan: 1,
                rowspan: 1,
              },
            ],
          },
        ],
      },
    ]);
    let at = -1;
    state.doc.descendants((node, pos) => {
      if (node.attrs.id === 'li1') at = pos + 4;
    });
    const placed = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
    const outcome = pasteInto(
      placed,
      readClipboard(
        clipboard({ 'text/html': '<p>A</p><blockquote><p>Said</p></blockquote><p>B</p>' }),
        'blocks',
      ),
      counter('p'),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.report.at(-1)).toMatchObject({ action: 'refused', subject: 'invalid' });
  });
});

describe('pasting Markdown, when asked', () => {
  it('reads the text as Markdown, keeping its structure', async () => {
    const state = stateOf([paragraph('b1', '')]);
    const outcome = pasteInto(
      state,
      await readMarkdownText('- **One**\n- Two\n', 'blocks'),
      counter('p'),
    );
    if (!outcome.ok) throw new Error(outcome.report.at(-1)?.message);
    expect(stored(state.apply(outcome.transaction))).toMatchObject([
      {
        type: 'list',
        kind: 'unordered',
        items: [
          { content: [{ content: [{ value: 'One', marks: [{ type: 'strong' }] }] }] },
          { content: [{ content: [{ value: 'Two' }] }] },
        ],
      },
    ]);
  });

  it('keeps it exactly in preformatted text, where Markdown means nothing', async () => {
    const reading = await readMarkdownText('**not bold**', 'preformatted');
    expect(reading.ok && reading.input.candidate).toEqual({
      schemaVersion: 1,
      content: [{ type: 'preformatted', text: '**not bold**' }],
    });
  });
});

describe('copying', () => {
  it("writes a selection in the product's own format, with the component's language", () => {
    const state = stateOf([paragraph('b1', 'York Leeds')]);
    const text = productClipboard(state, 1, 5)!;
    expect(JSON.parse(text)).toEqual({
      format: 'alloy-works/content',
      schemaVersion: 1,
      language: 'en-GB',
      direction: 'ltr',
      content: [paragraph('b1', 'York')],
    });
  });

  it('writes nothing of its own for a selection that is not a document on its own', () => {
    const state = stateOf([
      {
        type: 'blockquote',
        id: 'q1',
        content: [paragraph('b1', 'Said')],
        attribution: [{ type: 'text', value: 'Ada', marks: [] }],
      },
    ]);
    // Inside the attribution alone: a quotation holding nothing but its attribution is no block.
    const attribution = state.doc.firstChild!.lastChild!;
    const start = state.doc.content.size - 1 - attribution.nodeSize;
    expect(productClipboard(state, start + 1, start + 3)).toBeUndefined();
  });
});

/**
 * Cross-references 1, ruling R8: a paste re-points the references its component still holds at the
 * block they named, where the paste brought that block back under a new identifier - a cut and a
 * paste - and changes nothing where the block still stands - a copy and a paste. Every paste is
 * applied through `createEditorState`'s own plugins, so the identity plugin has had its say.
 */
describe('pasting what a cross-reference points at', () => {
  type Inline = Extract<
    ContentDocument['content'][number],
    { type: 'paragraph' }
  >['content'][number];
  const text = (value: string): Inline => ({ type: 'text', value, marks: [] });
  const to = (id: string, block: string): Inline => ({
    type: 'crossReference',
    id,
    target: { kind: 'block', block },
    display: 'number',
  });
  const withRuns = (id: string, ...content: Inline[]) => ({
    type: 'paragraph' as const,
    id,
    style: 'body',
    content,
  });
  const table = (id: string) => ({
    type: 'table' as const,
    id,
    style: 'table',
    caption: [text('Readings')],
    headerRows: 0,
    headerColumns: 0,
    rows: [{ cells: [{ content: [paragraph(`${id}c`, 'North')], colspan: 1, rowspan: 1 }] }],
  });

  /** Where the node carrying this identifier starts, and where it ends. */
  const rangeOf = (state: EditorState, id: string) => {
    let from = -1;
    state.doc.descendants((node, pos) => {
      if (from === -1 && node.attrs.id === id) from = pos;
      return from === -1;
    });
    if (from === -1) throw new Error(`no ${id}`);
    return { from, to: from + state.doc.nodeAt(from)!.nodeSize };
  };

  /** The product's clipboard for the whole of the block carrying this identifier. */
  const copyOf = (state: EditorState, id: string) => {
    const { from, to } = rangeOf(state, id);
    const copied = productClipboard(state, from, to);
    if (copied === undefined) throw new Error(`nothing copied of ${id}`);
    return { [PRODUCT_CLIPBOARD_TYPE]: copied };
  };

  /** The state with the block carrying this identifier taken out, as a cut takes it. */
  const cut = (state: EditorState, id: string) => {
    const { from, to } = rangeOf(state, id);
    return state.apply(state.tr.delete(from, to));
  };

  /** A caret at the end of the textblock carrying this identifier. */
  const atEndOf = (state: EditorState, id: string) => at(state, rangeOf(state, id).to - 1);

  /** Every reference's identifier and the block it points at, in document order. */
  const referencesIn = (state: EditorState): [unknown, unknown][] => {
    const found: [unknown, unknown][] = [];
    state.doc.descendants((node) => {
      if (node.type.name === 'crossReference') {
        found.push([node.attrs.id, (node.attrs.target as { block?: string }).block]);
      }
    });
    return found;
  };

  /** Pastes, answering the state afterwards and the report the paste returned. */
  const pasted = (state: EditorState, data: Record<string, string>) => {
    const outcome = pasteInto(state, readClipboard(clipboard(data), 'blocks'), counter('p'));
    if (!outcome.ok) throw new Error(outcome.report.at(-1)?.message);
    return { state: state.apply(outcome.transaction), report: outcome.report };
  };

  const tableIds = (state: EditorState) =>
    stored(state)
      .filter((block) => block.type === 'table')
      .map((block) => block.id);

  it('points a reference left behind at a table cut and pasted back, the table newly named', () => {
    const state = stateOf([
      withRuns('b1', text('See '), to('x1', 't1')),
      table('t1'),
      paragraph('b2', 'End'),
    ]);
    const clipped = copyOf(state, 't1');
    const { state: back, report } = pasted(atEndOf(cut(state, 't1'), 'b2'), clipped);
    const [id] = tableIds(back);
    expect(id).not.toBe('t1');
    expect(referencesIn(back)).toEqual([['x1', id]]);
    expect(report).toContainEqual(
      expect.objectContaining({
        action: 'rewritten',
        subject: 'crossReferenceRepointed',
        count: 1,
      }),
    );
    expect(() => fromEditor(back.doc)).not.toThrow();
  });

  it('leaves a reference alone when what it points at was copied and still stands', () => {
    const state = stateOf([
      withRuns('b1', text('See '), to('x1', 't1')),
      table('t1'),
      paragraph('b2', 'End'),
    ]);
    const { state: next, report } = pasted(atEndOf(state, 'b2'), copyOf(state, 't1'));
    const ids = tableIds(next);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe('t1');
    expect(ids[1]).not.toBe('t1');
    expect(referencesIn(next)).toEqual([['x1', 't1']]);
    expect(report.map((entry) => entry.subject)).not.toContain('crossReferenceRepointed');
  });

  it('keeps a reference that travelled with its table pointing at the copy, after identity has run', () => {
    const state = stateOf([
      withRuns('b1', text('See '), to('x1', 't1')),
      table('t1'),
      paragraph('b2', 'End'),
    ]);
    const { from } = rangeOf(state, 'b1');
    const { to: end } = rangeOf(state, 't1');
    const copied = productClipboard(state, from, end)!;
    const { state: next } = pasted(atEndOf(state, 'b2'), { [PRODUCT_CLIPBOARD_TYPE]: copied });
    const [, copy] = tableIds(next);
    const references = referencesIn(next);
    expect(references).toHaveLength(2);
    expect(references[0]).toEqual(['x1', 't1']);
    // The copy's reference is newly named and points at the copied table, as admission left it.
    expect(references[1]![0]).not.toBe('x1');
    expect(references[1]![1]).toBe(copy);
  });

  it('pastes a reference copied within the product, still pointing at what the component holds', () => {
    const state = stateOf([
      withRuns('b1', text('See '), to('x1', 't1')),
      table('t1'),
      paragraph('b2', 'End'),
    ]);
    const { state: next } = pasted(atEndOf(state, 'b2'), copyOf(state, 'b1'));
    const references = referencesIn(next);
    expect(references).toHaveLength(2);
    expect(references[1]![0]).not.toBe('x1');
    expect(references[1]![1]).toBe('t1');
  });

  it("re-points a reference in a footnote's text, and takes one pasted into a footnote", () => {
    const footnote = (id: string, ...content: Inline[]): Inline => ({
      type: 'footnote',
      id,
      anchor: { kind: 'span' },
      content: [withRuns(`${id}p`, ...content)],
    });
    const state = stateOf([
      withRuns('b1', text('Visited'), footnote('f1', text('See '), to('x1', 't1'))),
      table('t1'),
      paragraph('b2', 'End'),
      withRuns('b3', text('Noted'), footnote('f2', text('Also'))),
    ]);
    // Cut and pasted back: the reference in the footnote's text is re-pointed with the rest.
    const { state: back } = pasted(atEndOf(cut(state, 't1'), 'b2'), copyOf(state, 't1'));
    const [id] = tableIds(back);
    expect(referencesIn(back)).toEqual([['x1', id]]);
    // And a paragraph holding a reference, pasted into another footnote's text, stands there.
    const intoNote = atEndOf(back, 'f2p');
    const reference = pasted(intoNote, {
      [PRODUCT_CLIPBOARD_TYPE]: JSON.stringify({
        format: 'alloy-works/content',
        schemaVersion: 1,
        content: [withRuns('z1', text(' and '), to('z2', id!))],
      }),
    }).state;
    const note = (stored(reference)[3] as { content: { type: string; content?: unknown }[] })
      .content[1]!;
    expect(note).toMatchObject({
      type: 'footnote',
      id: 'f2',
      content: [
        {
          content: [
            { type: 'text', value: 'Also and ' },
            { type: 'crossReference', target: { kind: 'block', block: id } },
          ],
        },
      ],
    });
  });
});

/**
 * B1-C: a binding's identifier is what keeps its values in every document, so a copy is a new binding
 * and a move - a cut and a paste, a paste over it, a paste into another component - keeps it.
 */
describe('copying, cutting and pasting a binding', () => {
  type Inline = Extract<
    ContentDocument['content'][number],
    { type: 'paragraph' }
  >['content'][number];
  const text = (value: string): Inline => ({ type: 'text', value, marks: [] });
  const bound = (id: string): Inline => ({
    type: 'binding',
    id,
    query: '00000000-0000-4000-8000-00000000d001',
    parameters: { site: { literal: 'north' } },
    mode: 'checked',
    take: { column: 'depth' },
  });
  const withRuns = (id: string, ...content: Inline[]) => ({
    type: 'paragraph' as const,
    id,
    style: 'body',
    content,
  });

  const rangeOf = (state: EditorState, id: string) => {
    let from = -1;
    state.doc.descendants((node, pos) => {
      if (from === -1 && node.attrs.id === id) from = pos;
      return from === -1;
    });
    if (from === -1) throw new Error(`no ${id}`);
    return { from, to: from + state.doc.nodeAt(from)!.nodeSize };
  };
  const copyOf = (state: EditorState, id: string) => {
    const { from, to } = rangeOf(state, id);
    return { [PRODUCT_CLIPBOARD_TYPE]: productClipboard(state, from, to)! };
  };
  const cut = (state: EditorState, id: string) => {
    const { from, to } = rangeOf(state, id);
    return state.apply(state.tr.delete(from, to));
  };
  const atEndOf = (state: EditorState, id: string) => at(state, rangeOf(state, id).to - 1);
  const bindingsIn = (state: EditorState): unknown[] => {
    const found: unknown[] = [];
    state.doc.descendants((node) => {
      if (node.type.name === 'binding') found.push(node.attrs.id);
    });
    return found;
  };
  const pasted = (state: EditorState, data: Record<string, string>) => {
    const outcome = pasteInto(state, readClipboard(clipboard(data), 'blocks'), counter('p'));
    if (!outcome.ok) throw new Error(outcome.report.at(-1)?.message);
    return { state: state.apply(outcome.transaction), report: outcome.report };
  };
  const counts = (report: readonly { action: string; subject: string; count?: number }[]) =>
    report
      .filter((entry) => entry.subject === 'bindingCopied' || entry.subject === 'bindingIdentifier')
      .map(({ action, subject, count }) => ({ action, subject, count }));

  const component = () =>
    stateOf([withRuns('b1', text('Mean '), bound('k1')), paragraph('b2', 'End')]);

  it('gives a copy pasted into its own component a new identifier, and counts it copied', () => {
    const state = component();
    const { state: next, report } = pasted(atEndOf(state, 'b2'), copyOf(state, 'b1'));
    const [original, copy] = bindingsIn(next);
    expect(original).toBe('k1');
    expect(copy).not.toBe('k1');
    expect(counts(report)).toEqual([{ action: 'rewritten', subject: 'bindingCopied', count: 1 }]);
    expect(() => fromEditor(next.doc)).not.toThrow();
  });

  it('gives a binding cut and pasted in its component its own identifier back, saying it kept it', () => {
    const state = component();
    const clipped = copyOf(state, 'b1');
    const { state: back, report } = pasted(atEndOf(cut(state, 'b1'), 'b2'), clipped);
    expect(bindingsIn(back)).toEqual(['k1']);
    expect(counts(report)).toEqual([{ action: 'kept', subject: 'bindingIdentifier', count: 1 }]);
    // And a second paste of what was cut is a copy: k1 stands again.
    const { state: twice, report: again } = pasted(atEndOf(back, 'b2'), clipped);
    const [first, second] = bindingsIn(twice);
    expect(first).toBe('k1');
    expect(second).not.toBe('k1');
    expect(counts(again)).toEqual([{ action: 'rewritten', subject: 'bindingCopied', count: 1 }]);
  });

  it("never points a reference left behind at a binding's copy, though its target names the binding", () => {
    // Content the API could have stored: a reference whose block target is a binding's identifier,
    // which no block holds. The binding arrives from elsewhere under that identifier.
    const reference: Inline = {
      type: 'crossReference',
      id: 'x1',
      target: { kind: 'block', block: 'k9' },
      display: 'number',
    };
    const from = stateOf([withRuns('b1', text('Mean '), bound('k9'))]);
    const state = stateOf([withRuns('o1', text('See '), reference), paragraph('o2', 'End')]);
    const { state: next, report } = pasted(atEndOf(state, 'o2'), copyOf(from, 'b1'));
    const targets: unknown[] = [];
    next.doc.descendants((node) => {
      if (node.type.name === 'crossReference') targets.push(node.attrs.target);
    });
    expect(targets).toEqual([{ kind: 'block', block: 'k9' }]);
    expect(report.some((entry) => entry.subject === 'crossReferenceRepointed')).toBe(false);
    expect(bindingsIn(next)).toEqual(['k9']);
  });

  it('keeps the identifier of a binding pasted over its original', () => {
    const state = component();
    const { from, to } = rangeOf(state, 'b1');
    const over = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, from + 1, to - 1)),
    );
    const { state: next, report } = pasted(over, copyOf(state, 'b1'));
    expect(bindingsIn(next)).toEqual(['k1']);
    expect(counts(report)).toEqual([{ action: 'kept', subject: 'bindingIdentifier', count: 1 }]);
  });

  it('keeps the identifier of a binding pasted into another component, promising no value there', () => {
    const from = component();
    const other = stateOf([paragraph('o1', 'Other')]);
    const { state: next, report } = pasted(atEndOf(other, 'o1'), copyOf(from, 'b1'));
    expect(bindingsIn(next)).toEqual(['k1']);
    const kept = report.find((entry) => entry.subject === 'bindingIdentifier');
    expect(kept?.message).toBe(
      'Bound values kept their identifiers. One moved from another component shows no value in a document until it is resolved there.',
    );
  });

  it("takes a binding pasted into a footnote's text", () => {
    const footnote: Inline = {
      type: 'footnote',
      id: 'f1',
      anchor: { kind: 'span' },
      content: [withRuns('f1p', text('Also'))],
    };
    const state = stateOf([
      withRuns('b1', text('Mean '), bound('k1')),
      withRuns('b2', text('Noted'), footnote),
    ]);
    const { state: next } = pasted(atEndOf(state, 'f1p'), copyOf(state, 'b1'));
    const note = (stored(next)[1] as { content: { type: string; content?: unknown }[] })
      .content[1]!;
    expect(note).toMatchObject({
      type: 'footnote',
      id: 'f1',
      content: [{ content: [{ type: 'text', value: 'AlsoMean ' }, { type: 'binding' }] }],
    });
  });
});

/**
 * Equations 1: the product's own clipboard carries an equation whole, inline or a block, its LaTeX
 * with it where it has one - the one way an equation is pasted in this slice.
 */
describe('copying and pasting an equation', () => {
  type Inline = Extract<
    ContentDocument['content'][number],
    { type: 'paragraph' }
  >['content'][number];
  const NS = 'http://www.w3.org/1998/Math/MathML';
  const SQUARED = `<math xmlns="${NS}" alttext="x squared"><msup><mi>x</mi><mn>2</mn></msup></math>`;
  const text = (value: string): Inline => ({ type: 'text', value, marks: [] });
  const typed: Inline = { type: 'equation', mathml: SQUARED, latex: 'x^2' };
  const untyped: Inline = { type: 'equation', mathml: SQUARED };
  const withRuns = (id: string, ...content: Inline[]) => ({
    type: 'paragraph' as const,
    id,
    style: 'body',
    content,
  });
  const block = (id: string) => ({
    type: 'equation' as const,
    id,
    mathml: SQUARED,
    latex: 'x^2',
    numbered: true,
  });

  /** Where the node carrying this identifier starts, and where it ends. */
  const rangeOf = (state: EditorState, id: string) => {
    let from = -1;
    state.doc.descendants((node, pos) => {
      if (from === -1 && node.attrs.id === id) from = pos;
      return from === -1;
    });
    if (from === -1) throw new Error(`no ${id}`);
    return { from, to: from + state.doc.nodeAt(from)!.nodeSize };
  };

  /** The product's clipboard for the whole of the node carrying this identifier. */
  const copyOf = (state: EditorState, id: string) => {
    const { from, to } = rangeOf(state, id);
    const copied = productClipboard(state, from, to);
    if (copied === undefined) throw new Error(`nothing copied of ${id}`);
    return { [PRODUCT_CLIPBOARD_TYPE]: copied };
  };

  /** A caret at the end of the textblock carrying this identifier. */
  const atEndOf = (state: EditorState, id: string) => at(state, rangeOf(state, id).to - 1);

  const pasting = (state: EditorState, data: Record<string, string>) =>
    pasteInto(state, readClipboard(clipboard(data), 'blocks'), counter('p'));

  it('pastes inline equations copied within the product whole, with their LaTeX or without', () => {
    const state = stateOf([
      withRuns('b1', text('Where '), typed, text(' or '), untyped),
      paragraph('b2', 'End '),
    ]);
    const next = paste(atEndOf(state, 'b2'), copyOf(state, 'b1'));
    expect(stored(next)[1]).toEqual(
      withRuns('b2', text('End Where '), typed, text(' or '), untyped),
    );
  });

  it('pastes a block equation copied within the product whole and newly named, the original still standing', () => {
    const state = stateOf([paragraph('b1', 'Where'), block('e1'), paragraph('b2', 'End')]);
    const next = paste(atEndOf(state, 'b2'), copyOf(state, 'e1'));
    const equations = stored(next).filter((each) => each.type === 'equation');
    expect(equations).toHaveLength(2);
    expect(equations[0]).toEqual(block('e1'));
    expect(equations[1]).toEqual({ ...block(equations[1]!.id) });
    expect(equations[1]!.id).not.toBe('e1');
  });

  it("takes an inline equation pasted into a footnote's text, and refuses a block one there by name", () => {
    const state = stateOf([
      withRuns('b1', text('Visited'), {
        type: 'footnote',
        id: 'f1',
        anchor: { kind: 'span' },
        content: [withRuns('f1p', text('Once'))],
      }),
      block('e1'),
      withRuns('b2', text('Where '), typed),
    ]);
    const inNote = atEndOf(state, 'f1p');
    const outcome = pasting(inNote, copyOf(state, 'b2'));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const note = (fromEditor(outcome.transaction.doc).content[0] as { content: Inline[] })
      .content[1] as { content: { content: Inline[] }[] };
    expect(note.content[0]!.content).toEqual([text('OnceWhere '), typed]);

    const refused = pasting(inNote, copyOf(state, 'e1'));
    expect(refused.ok).toBe(false);
    expect(refused.report.slice(-2)).toMatchObject([
      { action: 'discarded', subject: 'unrepresentable', detail: 'equation' },
      { action: 'refused', subject: 'invalid' },
    ]);
  });

  it("refuses a block equation pasted into a list in a table's cell, which the store would not take", () => {
    const state = stateOf([
      {
        type: 'table',
        id: 't1',
        style: 'table',
        caption: [],
        headerRows: 0,
        headerColumns: 0,
        rows: [
          {
            cells: [
              {
                content: [
                  {
                    type: 'list',
                    id: 'l1',
                    kind: 'unordered',
                    items: [{ content: [paragraph('li1', 'one')] }],
                  },
                ],
                colspan: 1,
                rowspan: 1,
              },
            ],
          },
        ],
      },
      block('e1'),
    ]);
    const outcome = pasting(atEndOf(state, 'li1'), copyOf(state, 'e1'));
    expect(outcome.ok).toBe(false);
    expect(outcome.report.at(-1)).toMatchObject({ action: 'refused', subject: 'invalid' });
  });
});
