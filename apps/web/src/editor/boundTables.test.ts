import {
  bindingDigestInput,
  parseContentDocument,
  type BoundTableNode,
  type CanonicalResult,
  type TableColumn,
} from '@alloy-works/domain';
import {
  createEditorState,
  CURRENT_TABLE_CLASS,
  FOCUSED_COLUMN_CLASS,
  focusBoundTableColumn,
  fromEditor,
  mountEditor,
  pasteInto,
  readClipboard,
  renderContent,
  Selection,
  toEditor,
  type BindingContext,
  type EditorView,
} from '@alloy-works/editor';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * A bound table drawn on the editing surface and in a document's read text (the TB2 plan, task 2;
 * TB2-D): a real table labelled by its caption, its headers and first rows from what the document
 * holds, the same cells in both, drawn again only when what it shows changes.
 */

const QUERY = '00000000-0000-4000-8000-00000000d001';
const text = (value: string) => ({ type: 'text', value, marks: [] });
const binding = {
  type: 'binding' as const,
  id: 'k1',
  query: QUERY,
  parameters: {},
  mode: 'checked' as const,
};

const table = (over: Partial<BoundTableNode> = {}): BoundTableNode => ({
  type: 'boundTable',
  id: 't1',
  style: 'table',
  binding,
  caption: [text('Readings') as never],
  columns: [
    { column: 'site', header: 'Site' },
    { column: 'depth', header: 'Depth', unit: { text: 'm', place: 'header' } },
  ],
  headerColumn: true,
  ...over,
});

const component = (over: Partial<BoundTableNode> = {}) =>
  parseContentDocument({
    schemaVersion: 1,
    title: 'Sites',
    language: 'en-GB',
    direction: 'ltr',
    content: [
      { type: 'paragraph', id: 'p1', style: 'body', content: [text('Before.')] },
      table(over),
    ],
  });

const DECLARED: TableColumn[] = [
  { name: 'site', type: { base: 'text' } },
  { name: 'depth', type: { base: 'decimal', precision: 10, scale: 2 } },
];

const rows = (count: number): CanonicalResult => ({
  columns: [
    ['site', 'text'],
    ['depth', 'decimal'],
  ],
  rows: Array.from({ length: count }, (_, at) => [`S${at}`, `-${at}.5`]),
});

const holding = (result: CanonicalResult, rowCount = result.rows.length): BindingContext => ({
  kind: 'document',
  node: 'n1',
  held: new Map([
    [
      'k1',
      {
        binding: bindingDigestInput(binding),
        shown: { table: { columns: DECLARED, rowCount, rows: result } },
      },
    ],
  ]),
});

const mounted: EditorView[] = [];
afterEach(() => {
  for (const view of mounted.splice(0)) view.destroy();
});

function mount(bindingContext: BindingContext | null, over: Partial<BoundTableNode> = {}) {
  const opened = toEditor(component(over));
  if (!opened.editable) throw new Error(opened.unsupported.join(', '));
  const place = document.createElement('div');
  document.body.append(place);
  const view = mountEditor(place, {
    state: createEditorState({ doc: opened.doc, newIdentifier: () => 'x', bindingContext }),
    label: 'Content',
    editable: () => true,
    dispatch: (tr, target) => target.updateState(target.state.apply(tr)),
    pasted: () => undefined,
    refused: () => undefined,
  });
  mounted.push(view);
  return view;
}

/** Every cell's text, row by row, the header row first. */
const cellsOf = (element: Element) =>
  [...element.querySelectorAll('tr')].map((row) =>
    [...row.querySelectorAll('th, td')].map((cell) => cell.textContent),
  );

describe('a bound table on the editing surface', () => {
  it('is outlined while the cursor stands in it, the column focused in its panel marked down its cells', () => {
    const view = mount(holding(rows(3)));
    const figure = view.dom.querySelector('figure[data-bound-table]')!;
    expect(figure).not.toHaveClass(CURRENT_TABLE_CLASS);
    let caption = -1;
    view.state.doc.descendants((node, pos) => {
      if (caption < 0 && node.type.name === 'tableCaption') caption = pos + 1;
    });
    view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(caption))));
    expect(view.dom.querySelector('figure[data-bound-table]')).toHaveClass(CURRENT_TABLE_CLASS);

    focusBoundTableColumn(1)(view.state, view.dispatch);
    const marked = [...view.dom.querySelectorAll(`.${FOCUSED_COLUMN_CLASS}`)].map(
      (cell) => cell.textContent,
    );
    expect(marked).toEqual(['Depth (m)', '-0.50', '-1.50', '-2.50']);
    focusBoundTableColumn(null)(view.state, view.dispatch);
    expect(view.dom.querySelectorAll(`.${FOCUSED_COLUMN_CLASS}`)).toHaveLength(0);
  });
  it('draws a table labelled by its caption: headers with units, the first 50 rows, and how many more', () => {
    const view = mount(holding(rows(120)));
    const grid = view.dom.querySelector('[data-bound-table-body] table')!;
    const caption = view.dom.querySelector('figure[data-bound-table] > figcaption')!;
    expect(caption.id).not.toBe('');
    expect(grid).toHaveAttribute('aria-labelledby', caption.id);
    expect(caption).toHaveTextContent('Readings');
    const headers = [...grid.querySelectorAll('thead th')];
    expect(headers.map((each) => each.getAttribute('scope'))).toEqual(['col', 'col']);
    expect(headers.map((each) => each.textContent)).toEqual(['Site', 'Depth (m)']);
    const body = [...grid.querySelectorAll('tbody tr')];
    expect(body).toHaveLength(50);
    // The first column heads its row; a number column aligns on its decimal separator.
    expect(body[0]!.querySelector('th')).toHaveAttribute('scope', 'row');
    expect(body[0]!.querySelector('th')).toHaveTextContent('S0');
    expect(body[1]!.querySelector('td')).toHaveAttribute('data-align', 'decimal');
    expect(body[1]!.querySelector('td')).toHaveTextContent('-1.50');
    // Beneath it, outside the table.
    const more = view.dom.querySelector('[data-bound-table-body] > .aw-bound-table-more')!;
    expect(more).toHaveTextContent('and 70 more rows');
    expect(grid.contains(more)).toBe(false);
  });

  it('shows a failure in place, drawn apart, with its headers', () => {
    const view = mount(holding(rows(3), 2_001));
    const body = view.dom.querySelector('[data-bound-table-body]')!;
    expect(body).toHaveClass('aw-binding-failed');
    expect(cellsOf(body)).toEqual([
      ['Site', 'Depth (m)'],
      ['No rows - the result has 2001 rows, more than a table prints'],
    ]);
    expect(view.dom.querySelector('p')).toHaveTextContent('Before.');
  });

  it('draws the body again only when what it shows changes, never for a keystroke in its caption', () => {
    const view = mount(holding(rows(3)));
    const grid = view.dom.querySelector('[data-bound-table-body] table')!;
    let captionEnd = 0;
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCaption') captionEnd = pos + node.nodeSize - 1;
    });
    view.dispatch(
      view.state.tr
        .setSelection(Selection.near(view.state.doc.resolve(captionEnd)))
        .insertText(' by site'),
    );
    expect(view.dom.querySelector('figcaption')).toHaveTextContent('Readings by site');
    expect(view.dom.querySelector('[data-bound-table-body] table')).toBe(grid);
    // A header edited is drawn at once, with no save between (TB2-D).
    let tablePos = 0;
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'boundTable') tablePos = pos;
    });
    view.dispatch(
      view.state.tr.setNodeAttribute(tablePos, 'columns', [{ column: 'site', header: 'Place' }]),
    );
    expect(cellsOf(view.dom.querySelector('[data-bound-table-body]')!)[0]).toEqual(['Place']);
  });
});

describe("a bound table in a document's read text", () => {
  it('draws the same cells as the editing surface', () => {
    const context = holding(rows(60));
    const view = mount(context);
    const rendered = renderContent(component(), document, null, context)!;
    const holder = document.createElement('div');
    holder.append(rendered);
    const read = holder.querySelector('[data-bound-table-body]')!;
    expect(cellsOf(read)).toEqual(cellsOf(view.dom.querySelector('[data-bound-table-body]')!));
    expect(read.querySelector('.aw-bound-table-more')).toHaveTextContent('and 10 more rows');
    const caption = holder.querySelector('figure[data-bound-table] > figcaption')!;
    expect(read.querySelector('table')).toHaveAttribute('aria-labelledby', caption.id);
  });

  it('pastes as an authored table of the values when copied from the read text, and says so', () => {
    const rendered = renderContent(component(), document, null, holding(rows(2)))!;
    const holder = document.createElement('div');
    holder.append(rendered);
    const html = holder.querySelector('figure[data-bound-table]')!.outerHTML;
    const opened = toEditor(component());
    if (!opened.editable) throw new Error('not editable');
    const state = createEditorState({ doc: opened.doc, newIdentifier: () => 'x' });
    const at = state.apply(state.tr.setSelection(Selection.near(state.doc.resolve(8))));
    let next = 1;
    const outcome = pasteInto(
      at,
      readClipboard({ types: ['text/html'], getData: () => html }, 'blocks'),
      () => `pasted${(next += 1)}`,
    );
    if (!outcome.ok) throw new Error(JSON.stringify(outcome.report));
    const blocks = fromEditor(at.apply(outcome.transaction).doc).content;
    const pasted = blocks.find((block) => block.type === 'table');
    expect(pasted).toBeDefined();
    const values = (pasted as Extract<typeof pasted, { type: 'table' }>).rows.map((row) =>
      row.cells.map((cell) =>
        cell.content.map((block) =>
          block.type === 'paragraph'
            ? block.content.map((run) => (run.type === 'text' ? run.value : '')).join('')
            : '',
        ),
      ),
    );
    expect(values).toEqual([
      [['Site'], ['Depth (m)']],
      [['S0'], ['-0.50']],
      [['S1'], ['-1.50']],
    ]);
    // Noted: the paste's report says the table's cells were given new identifiers, as any paste's are.
    expect(outcome.report).toEqual(
      expect.arrayContaining([expect.objectContaining({ subject: 'blockIdentifier' })]),
    );
    // And the bound table it was copied from is still the one bound table.
    expect(blocks.filter((block) => block.type === 'boundTable')).toHaveLength(1);
  });
});
