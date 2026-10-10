import { bindingDigestInput, type CanonicalResult, type TableColumn } from '@alloy-works/domain';
import { DEFAULT_TABLE_SETTING, type BindingContext, type EditorView } from '@alloy-works/editor';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { shimRangeMeasurement } from '../test/range.js';
import { BOUND_TABLE_WORDS, repeatedWords } from './BoundTablePanel.js';
import { columnsLeftOut } from './ComponentEditor.js';
import { FORMAT_MEMBERS, FORMAT_WORDS, STYLE_SAYS } from './FormatDialog.js';
import { PLACE_AS } from './ValueDialog.js';
import {
  content,
  json,
  lock,
  open,
  opened,
  quick,
  selectText,
  SESSION,
  type Answer,
} from './test/componentEditor.js';

shimRangeMeasurement();

afterEach(() => vi.restoreAllMocks());

/**
 * Placing and shaping a bound table in the editor (the TB2 plan, task 4): Place as Table in the Value
 * dialog, the Bound table panel and its Format dialog, and Change on its binding - each drawn in the
 * body at once, from the rows the document holds, without a save.
 */

const READINGS = 'abcdef01-0000-4000-8000-000000000001';
const VISITS = 'abcdef01-0000-4000-8000-000000000002';
const NODE = 'nnnnnnnnnnnnnnnnnnnnnnnnnn';

const DECLARED: TableColumn[] = [
  { name: 'site', type: { base: 'text' } },
  { name: 'depth', type: { base: 'decimal', precision: 10, scale: 2 } },
  { name: 'visits', type: { base: 'integer' } },
];

/** Four rows in stored order, two pairs tied on visits. */
const ROWS: CanonicalResult = {
  columns: [
    ['site', 'text'],
    ['depth', 'decimal'],
    ['visits', 'integer'],
  ],
  rows: [
    ['Ash', '2.50', '2'],
    ['Birch', '-1.25', '1'],
    ['Cedar', '3.00', '2'],
    ['Dogwood', '0.75', '1'],
  ],
};

const binding = (query = READINGS) => ({
  type: 'binding' as const,
  id: 'k1',
  query,
  parameters: {},
  mode: 'checked' as const,
});

const withTable = (
  columns: unknown[] = [{ column: 'site', header: 'Site' }],
  notes?: unknown[],
) => {
  const document = content('Before');
  document.content.push({
    type: 'boundTable',
    id: 'bt1',
    style: 'table',
    binding: binding(),
    caption: [{ type: 'text', value: 'Readings', marks: [] }],
    columns,
    headerColumn: false,
    ...(notes === undefined ? {} : { notes }),
  } as never);
  return document;
};

/** A note on a bound table (TB3-A), its words one paragraph. */
const note = (id: string, anchor: unknown, words: string) => ({
  type: 'footnote',
  id,
  anchor,
  content: [
    {
      type: 'paragraph',
      id: `${id}p`,
      style: 'body',
      content: [{ type: 'text', value: words, marks: [] }],
    },
  ],
});

/** The document holding `ROWS` for k1 as `held` binds it, laid out in this table style. */
const holding = (
  held = binding(),
  columns: readonly TableColumn[] = DECLARED,
  style: Record<string, unknown> = {},
  notes: { readonly key: readonly string[]; readonly rows: Record<string, number | null> } = {
    key: ['site'],
    rows: {},
  },
): BindingContext => ({
  kind: 'document',
  node: NODE,
  held: new Map([
    [
      'k1',
      {
        binding: bindingDigestInput(held),
        shown: {
          table: {
            columns,
            rowCount: ROWS.rows.length,
            rows: ROWS,
            key: notes.key,
            notes: notes.rows,
          },
        },
      },
    ],
  ]),
  tables: { ...DEFAULT_TABLE_SETTING, styles: new Map([['table', style]]) },
});

const definition = (id: string, title: string, columns: readonly TableColumn[]) => ({
  id,
  version: { id: `${id.slice(0, -2)}a2`, number: '0.2' },
  definition: {
    title,
    parameters: [],
    columns: columns.map((each) => ({ ...each, from: { column: each.name } })),
    key: [],
  },
  connection: { id: 'c', name: null, identity: 'service' },
  mayUse: true,
});

const routes = (declared: readonly TableColumn[] = DECLARED): Record<string, Answer> => ({
  'POST /v1/components/{id}/lock': () => json(200, { lock }),
  // Every save the session makes, each change in the panel saved in its turn.
  ...Object.fromEntries(
    Array.from({ length: 40 }, (_, at) => [
      `PUT /v1/components/{id}/iterations/{session}/${at + 1}`,
      () => json(200, { sequence: at + 1, lock }),
    ]),
  ),
  'GET /v1/query-definitions': () =>
    json(200, {
      items: [READINGS, VISITS].map((id) => ({
        id,
        title: id === READINGS ? 'Readings' : 'Visits',
        space: { id: 's', name: 'General' },
        connection: { id: 'c', name: null, identity: 'service' },
        retired: false,
        version: { id: 'v', number: '0.2' },
        changedAt: '2026-10-05T09:00:00.000Z',
      })),
      next: null,
      total: 2,
      facets: { spaces: [] },
    }),
  [`GET /v1/query-definitions/${READINGS}`]: () =>
    json(200, definition(READINGS, 'Readings', declared)),
  [`GET /v1/query-definitions/${VISITS}`]: () =>
    json(
      200,
      definition(
        VISITS,
        'Visits',
        DECLARED.filter((each) => each.name !== 'depth'),
      ),
    ),
});

/** Every row of the body as the cells' text, its header row first. */
const bodyOf = (view: EditorView) =>
  [...view.dom.querySelectorAll('[data-bound-table-body] tr')].map((row) =>
    // A value and its unit are kept together by a space that does not break.
    [...row.querySelectorAll('th, td')].map((cell) => cell.textContent?.replace(/\s/gu, ' ')),
  );

/** Opens a document's component holding a bound table, the cursor in its caption, and its panel. */
async function inTable(
  columns?: unknown[],
  extra: Parameters<typeof open>[3] = {},
  context: BindingContext = holding(),
  latest: readonly TableColumn[] = DECLARED,
  notes?: unknown[],
) {
  const opening = open(
    {
      'GET /v1/components/{id}': () => json(200, opened({ content: withTable(columns, notes) })),
      ...routes(latest),
    },
    quick,
    false,
    { bindingContext: context, ...extra },
  );
  const view = await opening.surface();
  // Into the caption: past the paragraph, into the table and its caption.
  selectText(view, 10, 10);
  const panel = await screen.findByRole('group', { name: 'Bound table' });
  // The definition's columns read, so the panel offers them.
  await waitFor(() =>
    expect(within(panel).getAllByRole('option', { name: 'visits' }).length).toBeGreaterThan(0),
  );
  return { ...opening, view, panel };
}

/** The column pills, in order (ADR-0052). */
const pills = (panel: HTMLElement) =>
  within(within(panel).getByRole('group', { name: 'Columns' })).getAllByRole('button');

/** The column in hand, as the Table tab shows it: one at a time, its pill pressed to take it. */
const inHand = (panel: HTMLElement, n: number) =>
  within(panel).getByRole('group', { name: `Column ${n}` });

/** Takes column n in hand by its pill, where it is not already, and answers its fields. */
async function column(panel: HTMLElement, n: number) {
  if (within(panel).queryByRole('group', { name: `Column ${n}` }) === null) {
    await userEvent.click(pills(panel)[n - 1]!);
  }
  return inHand(panel, n);
}

/**
 * A refusal, quiet (ADR-0051, decision 5): said once in the panel's live region, and marked on the
 * column's pill, described by the reason (ADR-0052).
 */
function expectRefused(panel: HTMLElement, n: number, words: string) {
  expect(within(panel).getByRole('status')).toHaveTextContent(words);
  expect(pills(panel)[n - 1]).toHaveAccessibleDescription(words);
}

describe('placing a bound table from the Value dialog (TB2-E)', () => {
  it('places a definition of 70 columns, two of them images, as a table of the first 64, says so, and tells the document', async () => {
    const wide: TableColumn[] = [
      { name: 'photo', type: { base: 'image', encoding: 'binary' } } as TableColumn,
      ...Array.from({ length: 68 }, (_, at) => ({
        name: `c${at}`,
        type: { base: 'text' as const },
      })),
      { name: 'map', type: { base: 'image', encoding: 'binary' } } as TableColumn,
    ];
    const onSettle = vi.fn();
    const { surface, asked } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened({ content: content('Before') })),
        ...routes(wide),
      },
      quick,
      false,
      {
        bindingContext: { kind: 'document', node: NODE, held: new Map() },
        bindingActs: { pinned: false, onSettle },
      },
    );
    const view = await surface();
    selectText(view, 7, 7);
    await userEvent.click(screen.getByRole('button', { name: 'Value' }));
    const dialog = await screen.findByRole('dialog', { name: 'Value' });
    await userEvent.click(await within(dialog).findByRole('radio', { name: /Readings/ }));
    await userEvent.click(await within(dialog).findByRole('radio', { name: 'As a table' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Insert' }));
    await waitFor(() => expect(onSettle).toHaveBeenCalledTimes(1));
    const placed = JSON.stringify(asked.find((each) => each.route.startsWith('PUT'))!.body);
    const table = /"type":"boundTable"[^]*?"binding":\{"type":"binding","id":"([^"]+)"/.exec(
      placed,
    );
    expect(table).not.toBeNull();
    expect(placed).not.toContain('"take"');
    expect(onSettle).toHaveBeenCalledWith(table![1], SESSION, 'placed');
    const headers = view.dom.querySelectorAll('[data-bound-table-body] th[scope="col"]');
    expect(headers).toHaveLength(64);
    expect(headers[0]).toHaveTextContent('c0');
    expect(headers[63]).toHaveTextContent('c63');
    // Said in the editor's own status, beside the band's live region.
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('status')
          .some((each) => each.textContent?.includes(columnsLeftOut(6)) === true),
      ).toBe(true),
    );
    // The cursor in its empty caption, the panels beside it.
    expect(view.state.selection.$from.parent.type.name).toBe('tableCaption');
    expect(await screen.findByRole('group', { name: 'Bound table' })).toBeInTheDocument();
  });
});

describe('the Bound table panel (TB2-F)', () => {
  it('TAB-001 adds, orders and removes the columns the body shows', async () => {
    const { view, panel } = await inTable();
    expect(bodyOf(view)[0]).toEqual(['Site']);
    await userEvent.click(within(panel).getByRole('button', { name: 'Add column' }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Add column' }));
    expect(bodyOf(view)[0]).toEqual(['Site', 'depth', 'visits']);
    await userEvent.click(
      within(await column(panel, 3)).getByRole('button', { name: 'Move left' }),
    );
    expect(bodyOf(view)[0]).toEqual(['Site', 'visits', 'depth']);
    expect(bodyOf(view)[1]).toEqual(['Ash', '2', '2.50']);
    await userEvent.click(within(await column(panel, 1)).getByRole('button', { name: 'Remove' }));
    expect(bodyOf(view)[0]).toEqual(['visits', 'depth']);
  });

  it('TAB-002 TAB-003 prints a header and a unit typed in the panel in the body, in the header or after each value', async () => {
    const { view, panel } = await inTable([
      { column: 'site', header: 'Site' },
      { column: 'depth', header: 'depth' },
    ]);
    const depth = await column(panel, 2);
    const header = within(depth).getByLabelText('Header');
    await userEvent.clear(header);
    await userEvent.type(header, 'Depth');
    await userEvent.type(within(depth).getByLabelText('Unit'), 'm');
    expect(bodyOf(view)[0]).toEqual(['Site', 'Depth (m)']);
    await userEvent.click(
      within(within(depth).getByRole('radiogroup', { name: 'Unit stands' })).getByRole('radio', {
        name: 'After each value',
      }),
    );
    expect(bodyOf(view)[0]).toEqual(['Site', 'Depth']);
    expect(bodyOf(view)[1]).toEqual(['Ash', '2.50 m']);
  });

  it('TAB-007 reorders the body by a sort added in the panel, ties keeping their stored order', async () => {
    const { view, panel } = await inTable([
      { column: 'site', header: 'Site' },
      { column: 'visits', header: 'Visits' },
    ]);
    await userEvent.click(within(panel).getByRole('button', { name: /^Sort/ }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Add sort' }));
    const key = within(panel).getByRole('group', { name: 'Sort 1' });
    await userEvent.selectOptions(within(key).getByLabelText('Column'), 'visits');
    expect(
      bodyOf(view)
        .slice(1)
        .map((row) => row[0]),
    ).toEqual(['Birch', 'Dogwood', 'Ash', 'Cedar']);
    await userEvent.click(
      within(within(key).getByRole('radiogroup', { name: 'Direction of Sort 1' })).getByRole(
        'radio',
        { name: 'Descending' },
      ),
    );
    expect(
      bodyOf(view)
        .slice(1)
        .map((row) => row[0]),
    ).toEqual(['Ash', 'Cedar', 'Birch', 'Dogwood']);
  });

  it("TAB-037 shows in the Format dialog the table style's value for each member left unset, and a member set overriding it alone", async () => {
    const { view, panel } = await inTable(
      [
        { column: 'site', header: 'Site' },
        { column: 'depth', header: 'Depth' },
      ],
      {},
      holding(binding(), DECLARED, { fields: { decimal: { places: 3, negative: 'parentheses' } } }),
    );
    expect(bodyOf(view)[2]).toEqual(['Birch', '(1.250)']);
    await userEvent.click(within(await column(panel, 2)).getByRole('button', { name: 'Format' }));
    const dialog = await screen.findByRole('dialog', { name: 'Format of Depth' });
    // Modal in full: the page behind it inert, the panel beside the text among it (ADR-0052).
    expect(panel.closest('body > *')).toHaveAttribute('inert');
    const places = within(dialog).getByLabelText('Decimal places');
    expect(places).toHaveAccessibleDescription(`Left unset. ${STYLE_SAYS}: 3`);
    expect(within(dialog).getByLabelText('Negative numbers')).toHaveDisplayValue(
      `${STYLE_SAYS}: ${FORMAT_WORDS.negative.parentheses}`,
    );
    expect(within(dialog).getByLabelText('Rounding')).toHaveDisplayValue(
      `${STYLE_SAYS}: ${FORMAT_WORDS.rounding.halfAwayFromZero}`,
    );
    // Only what a number takes: no fraction of a second.
    expect(within(dialog).queryByLabelText(FORMAT_MEMBERS.fraction)).toBeNull();
    await userEvent.type(places, '1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(panel.closest('body > *')).not.toHaveAttribute('inert');
    // One place, rounded half away from zero, still in the style's parentheses.
    expect(bodyOf(view)[2]).toEqual(['Birch', '(1.3)']);
    await waitFor(() =>
      expect(within(inHand(panel, 2)).getByRole('button', { name: 'Format' })).toHaveFocus(),
    );
    await userEvent.click(within(await column(panel, 2)).getByRole('button', { name: 'Format' }));
    const again = await screen.findByRole('dialog', { name: 'Format of Depth' });
    expect(within(again).getByLabelText('Decimal places')).toHaveValue(1);
    expect(within(again).getByLabelText('Negative numbers')).toHaveDisplayValue(
      `${STYLE_SAYS}: ${FORMAT_WORDS.negative.parentheses}`,
    );
  });

  it('TAB-048 refuses in the panel a second column of the same name under the same header, in the words of the walk', async () => {
    const { view, panel } = await inTable([
      { column: 'site', header: 'Site' },
      { column: 'depth', header: 'Depth' },
    ]);
    const second = await column(panel, 2);
    // The same column under another header is two columns.
    await userEvent.selectOptions(within(second).getByLabelText('Column'), 'site');
    expect(bodyOf(view)[1]).toEqual(['Ash', 'Ash']);
    const header = within(second).getByLabelText('Header');
    await userEvent.clear(header);
    expectRefused(panel, 2, BOUND_TABLE_WORDS.needsHeader);
    expect(header).toHaveAttribute('aria-invalid', 'true');
    await userEvent.type(header, 'SITE');
    expectRefused(panel, 2, repeatedWords('site'));
    expect(header).toHaveValue('SITE');
    expect(bodyOf(view)[0]).toEqual(['Site', 'SIT']);
  });

  it('refuses to remove the last column', async () => {
    const { view, panel } = await inTable();
    await userEvent.click(within(await column(panel, 1)).getByRole('button', { name: 'Remove' }));
    expectRefused(panel, 1, BOUND_TABLE_WORDS.lastColumn);
    expect(bodyOf(view)[0]).toEqual(['Site']);
  });

  it('adds an empty statement, a note and a source in place, and heads each row by its first column', async () => {
    const { view, panel } = await inTable();
    await userEvent.click(within(panel).getByRole('button', { name: 'Source' }));
    expect(view.state.selection.$from.parent.type.name).toBe('boundTableSource');
    await userEvent.click(
      within(panel).getByRole('button', { name: BOUND_TABLE_WORDS.headerColumn }),
    );
    expect(view.dom.querySelectorAll('[data-bound-table-body] th[scope="row"]')).toHaveLength(4);
    expect(within(panel).getByRole('button', { name: 'Source' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it("offers the columns of the version the document holds, not the definition's latest, and formats by their types (the TB2 final review)", async () => {
    // The definition has moved on to a version declaring only a tide, and depth as text.
    const latest: TableColumn[] = [
      { name: 'tide', type: { base: 'text' } },
      { name: 'depth', type: { base: 'text' } },
    ];
    const { panel } = await inTable(undefined, {}, holding(), latest);
    const options = [
      ...within(await column(panel, 1))
        .getByLabelText('Column')
        .querySelectorAll('option'),
    ];
    expect(options.map((each) => each.textContent)).toEqual(['site', 'depth', 'visits']);
    await userEvent.click(within(panel).getByRole('button', { name: 'Add column' }));
    await userEvent.click(within(await column(panel, 2)).getByRole('button', { name: 'Format' }));
    const dialog = await screen.findByRole('dialog', { name: 'Format of depth' });
    // A decimal's members, from the held version's type.
    expect(within(dialog).getByLabelText('Decimal places')).toBeInTheDocument();
  });

  it('lays out the Table tab: its value, the table, a pill per column and the one in hand, marked in the text (ADR-0052)', async () => {
    const { view, panel } = await inTable([
      { column: 'site', header: 'Site' },
      { column: 'depth', header: 'Depth' },
    ]);
    expect(within(panel).getByRole('region', { name: 'Value' })).toBeInTheDocument();
    expect(within(panel).getByRole('region', { name: 'Table' })).toHaveTextContent('Shows');
    expect(within(panel).getByRole('group', { name: 'Shows' })).toContainElement(
      within(panel).getByRole('button', { name: BOUND_TABLE_WORDS.numbered }),
    );
    expect(view.dom.querySelector('figure[data-bound-table]')).toHaveClass(
      'aw-bound-table-current',
    );
    // The first column in hand: its pill pressed, its section headed, its cells marked.
    expect(pills(panel).map((pill) => pill.textContent)).toEqual(['Site', 'Depth']);
    expect(pills(panel)[0]).toHaveAttribute('aria-pressed', 'true');
    expect(inHand(panel, 1)).toHaveTextContent('Column 1 of 2');
    const marked = () =>
      [...view.dom.querySelectorAll('.aw-bound-table-focused')].map((cell) => cell.textContent);
    expect(marked()).toEqual(bodyOf(view).map((row) => row[0]));
    // Another pill takes its column in hand, in the panel and the text.
    await userEvent.click(pills(panel)[1]!);
    expect(inHand(panel, 2)).toHaveTextContent('Column 2 of 2');
    expect(marked()).toEqual(bodyOf(view).map((row) => row[1]));
    // A press on a cell of the text's first column takes it in hand again. jsdom lays nothing out, so
    // the surface's own handling of the press, then and after, is told there is nothing under it.
    Object.defineProperty(document, 'elementFromPoint', { value: () => null, configurable: true });
    act(() => {
      view.dom
        .querySelector('[data-bound-table-body] tbody tr td, [data-bound-table-body] tbody tr th')!
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await waitFor(() => expect(pills(panel)[0]).toHaveAttribute('aria-pressed', 'true'));
    // Sort shows: no column is in hand in the text.
    await userEvent.click(within(panel).getByRole('button', { name: /^Sort/ }));
    expect(within(panel).getByText(BOUND_TABLE_WORDS.sortHint)).toBeInTheDocument();
    expect(view.dom.querySelectorAll('.aw-bound-table-focused')).toHaveLength(0);
  });

  it('opens one of Column, Sort and Notes at a time, each folded to its count and a summary (ADR-0052)', async () => {
    const { panel } = await inTable([
      { column: 'site', header: 'Site' },
      { column: 'depth', header: 'Depth' },
    ]);
    const fold = (name: RegExp) => within(panel).getByRole('button', { name });
    const summaryOf = (name: RegExp) => fold(name).closest('section')!;
    // Column open first, Sort and Notes folded, saying they hold none.
    expect(fold(/^Column/)).toHaveAttribute('aria-expanded', 'true');
    expect(fold(/^Sort/)).toHaveAttribute('aria-expanded', 'false');
    expect(summaryOf(/^Sort/)).toHaveTextContent(BOUND_TABLE_WORDS.none);
    expect(summaryOf(/^Notes/)).toHaveTextContent(BOUND_TABLE_WORDS.none);

    // Adding a sort from its folded heading opens Sort, and folds Column to where it is.
    await userEvent.click(within(panel).getByRole('button', { name: 'Add sort' }));
    expect(fold(/^Sort/)).toHaveAttribute('aria-expanded', 'true');
    expect(within(panel).queryByRole('group', { name: 'Column 1' })).toBeNull();
    expect(summaryOf(/^Column/)).toHaveTextContent('1 of 2, Site');
    const key = within(panel).getByRole('group', { name: 'Sort 1' });
    await userEvent.selectOptions(within(key).getByLabelText('Column'), 'depth');
    await userEvent.click(
      within(within(key).getByRole('radiogroup', { name: 'Direction of Sort 1' })).getByRole(
        'radio',
        { name: 'Descending' },
      ),
    );

    // Notes opened: Sort folds to what it sorts by.
    await userEvent.click(fold(/^Notes/));
    expect(fold(/^Sort/)).toHaveAttribute('aria-expanded', 'false');
    expect(summaryOf(/^Sort/)).toHaveTextContent('Depth descending');
    // A pill opens Column again, on its column.
    await userEvent.click(pills(panel)[1]!);
    expect(inHand(panel, 2)).toBeInTheDocument();
    expect(fold(/^Notes/)).toHaveAttribute('aria-expanded', 'false');
  });

  it('stands in the Table tab the page gives it, telling the page it holds a table and each time the cursor enters one (ADR-0052)', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const told = vi.fn();
    try {
      const { view, panel } = await inTable(undefined, { tableHost: host, onTable: told });
      expect(host).toContainElement(panel);
      expect(told).toHaveBeenLastCalledWith({ holds: true, entered: 1 });
      // Out of the table: the tab is the page's to keep or leave, and shows the table read only - its
      // settings as text, Provenance its one act, nothing to remove or add (ADR-0052, decision 5).
      act(() => selectText(view, 2, 2));
      const read = within(host).getByRole('group', { name: BOUND_TABLE_WORDS.panelReadOnly });
      expect(read).toHaveTextContent(BOUND_TABLE_WORDS.readOnly);
      expect(within(read).getByRole('region', { name: 'Table' })).toHaveTextContent(
        'Wide' + BOUND_TABLE_WORDS.wides.style,
      );
      expect(within(read).queryByRole('combobox')).toBeNull();
      expect(within(read).queryByRole('textbox')).toBeNull();
      for (const name of ['Change', 'Add column', 'Add sort', BOUND_TABLE_WORDS.deleteTable]) {
        expect(within(read).queryByRole('button', { name })).toBeNull();
      }
      act(() => selectText(view, 10, 10));
      expect(await within(host).findByRole('combobox', { name: 'Wide' })).toBeInTheDocument();
      expect(told).toHaveBeenLastCalledWith({ holds: true, entered: 2 });
    } finally {
      host.remove();
    }
  });

  it("shows a table's formatting read only to a reader who may not change the component, Provenance its one act (ADR-0052)", async () => {
    const host = document.createElement('div');
    document.body.append(host);
    try {
      const opening = open(
        {
          'GET /v1/components/{id}': () =>
            json(
              200,
              opened({
                content: withTable([
                  { column: 'site', header: 'Site' },
                  { column: 'depth', header: 'Depth' },
                ]),
                mayEdit: false,
              }),
            ),
          ...routes(DECLARED),
        },
        quick,
        false,
        { bindingContext: holding(), tableHost: host },
      );
      await opening.surface();
      const read = await within(host).findByRole('group', {
        name: BOUND_TABLE_WORDS.panelReadOnly,
      });
      expect(read).toHaveTextContent(BOUND_TABLE_WORDS.readOnly);
      expect(within(read).getByRole('group', { name: 'Column 1' })).toHaveTextContent('HeaderSite');
      // Another column by its pill; the folds open and close, and nothing can be changed.
      await userEvent.click(
        within(within(read).getByRole('group', { name: 'Columns' })).getAllByRole('button')[1]!,
      );
      expect(within(read).getByRole('group', { name: 'Column 2' })).toHaveTextContent(
        'HeaderDepth',
      );
      await userEvent.click(within(read).getByRole('button', { name: /^Sort/ }));
      expect(within(read).queryByRole('combobox')).toBeNull();
      expect(within(read).queryByRole('textbox')).toBeNull();
      expect(within(read).queryByRole('button', { name: 'Change' })).toBeNull();
    } finally {
      host.remove();
    }
  });

  it("shows a plain table's settings read only in the Table tab while the cursor is in no table (ADR-0052, TF-C)", async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const cell = (id: string, value: string) => ({
      content: [
        { type: 'paragraph', id, style: 'body', content: [{ type: 'text', value, marks: [] }] },
      ],
    });
    try {
      const document_ = content('Before');
      document_.content.push({
        type: 'table',
        id: 'pt1',
        style: 'table',
        caption: [{ type: 'text', value: 'Sites', marks: [] }],
        headerRows: 1,
        headerColumns: 0,
        rows: [{ cells: [cell('c1', 'Site'), cell('c2', 'Depth')] }],
      } as never);
      const opening = open(
        { 'GET /v1/components/{id}': () => json(200, opened({ content: document_ })) },
        quick,
        false,
        { tableHost: host },
      );
      await opening.surface();
      const read = await within(host).findByRole('group', {
        name: BOUND_TABLE_WORDS.tableReadOnly,
      });
      expect(read).toHaveTextContent(BOUND_TABLE_WORDS.readOnly);
      expect(read).toHaveTextContent('Header rows1');
      expect(read).toHaveTextContent('Size1 rows, 2 columns');
    } finally {
      host.remove();
    }
  });

  it('is a region F6 moves to, beside the Value panel', async () => {
    const { view, panel } = await inTable();
    act(() => view.focus());
    await userEvent.keyboard('{Shift>}{F6}{/Shift}');
    expect(screen.getByRole('region', { name: 'Value' })).toContainElement(
      document.activeElement as HTMLElement,
    );
    await userEvent.keyboard('{Shift>}{F6}{/Shift}');
    expect(panel).toContainElement(document.activeElement as HTMLElement);
  });

  it('undoes a panel change as one step', async () => {
    const { view, panel } = await inTable();
    await userEvent.click(within(panel).getByRole('button', { name: 'Add column' }));
    await userEvent.click(
      within(panel).getByRole('button', { name: BOUND_TABLE_WORDS.headerColumn }),
    );
    const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform);
    act(() => {
      view.someProp('handleKeyDown', (handle) =>
        handle(view, {
          key: 'z',
          keyCode: 90,
          ctrlKey: !mac,
          metaKey: mac,
          altKey: false,
          shiftKey: false,
        } as never),
      );
    });
    expect(view.dom.querySelectorAll('[data-bound-table-body] th[scope="row"]')).toHaveLength(0);
    expect(bodyOf(view)[0]).toEqual(['Site', 'depth']);
  });

  it('has words for everything it says with no fancy dash', () => {
    const fancy = new RegExp(`[${String.fromCodePoint(0x2013, 0x2014)}]`);
    const words = JSON.stringify([
      BOUND_TABLE_WORDS,
      FORMAT_MEMBERS,
      FORMAT_WORDS,
      STYLE_SAYS,
      PLACE_AS,
      columnsLeftOut(1),
      columnsLeftOut(6),
      repeatedWords('site'),
    ]);
    expect(words).not.toMatch(fancy);
  });
});

describe("a bound table's notes and Wide (TB3.3)", () => {
  const COLUMNS = [
    { column: 'site', header: 'Site' },
    { column: 'depth', header: 'Depth' },
  ];
  const notesOf = (view: EditorView) =>
    [...view.dom.querySelectorAll<HTMLElement>('[data-bound-table-note]')].map((each) =>
      each.textContent?.replace(/\s/gu, ' '),
    );

  it("draws a keyed note's letter in its cell and its words beneath, a column note's in its header, and a note whose row is gone failed in place", async () => {
    const { view } = await inTable(
      COLUMNS,
      {},
      holding(binding(), DECLARED, {}, { key: ['site'], rows: { f1: 1, f3: null } }),
      DECLARED,
      [
        note('f1', { kind: 'keyed', key: { site: 'Birch' }, column: 'depth' }, 'Estimated'),
        note('f2', { kind: 'column', column: 'site' }, 'By name'),
        note('f3', { kind: 'keyed', key: { site: 'Elm' }, column: 'depth' }, 'Closed'),
      ],
    );
    // The column's note first, then Birch's: a in the header, b in Birch's depth.
    expect(bodyOf(view)[0]).toEqual(['Sitea', 'Depth']);
    expect(bodyOf(view)[2]).toEqual(['Birch', '-1.25b']);
    expect(notesOf(view)).toEqual([
      'bEstimated',
      'aBy name',
      'No row has the key site Elm nowClosed',
    ]);
    const gone = view.dom.querySelectorAll('[data-bound-table-note]')[2]!;
    expect(gone).toHaveClass('aw-binding-failed');
  });

  it('adds a note on a cell by key, its value offered from the rows shown, and types its words in place, by keyboard', async () => {
    const user = userEvent.setup();
    const { view, panel } = await inTable(COLUMNS);
    await user.click(within(panel).getByRole('button', { name: /^Notes/ }));
    const adding = within(panel).getByRole('group', { name: BOUND_TABLE_WORDS.addNote });
    await user.click(within(adding).getByRole('radio', { name: BOUND_TABLE_WORDS.noteOns.cell }));
    await user.selectOptions(within(adding).getByLabelText(BOUND_TABLE_WORDS.noteColumn), 'depth');
    const key = within(adding).getByLabelText(BOUND_TABLE_WORDS.keyIs('site'));
    // Its values offered from the rows the page holds.
    expect(
      [...document.querySelectorAll(`#${CSS.escape(key.getAttribute('list')!)} option`)].map(
        (each) => each.getAttribute('value'),
      ),
    ).toEqual(['Ash', 'Birch', 'Cedar', 'Dogwood']);
    await user.click(key);
    await user.keyboard('Cedar');
    await user.tab();
    expect(within(adding).getByRole('button', { name: BOUND_TABLE_WORDS.addNote })).toHaveFocus();
    await user.keyboard('{Enter}');
    // The cursor in its words beneath the table, typed in place.
    expect(view.state.selection.$from.parent.type.name).toBe('footnoteParagraph');
    await user.keyboard('Dredged');
    expect(notesOf(view)).toEqual(['Dredged']);
    const listed = within(panel).getByRole('group', { name: 'Note 1' });
    expect(listed).toHaveTextContent('On Depth where site is Cedar');
    await user.click(within(listed).getByRole('button', { name: 'Remove note 1' }));
    expect(notesOf(view)).toEqual([]);
  });

  it('refuses to take out a column a note stands on, saying why (the TB3 final review, H1)', async () => {
    const { view, panel } = await inTable(COLUMNS, {}, holding(), DECLARED, [
      note('f2', { kind: 'column', column: 'depth' }, 'By gauge'),
    ]);
    await userEvent.click(within(await column(panel, 2)).getByRole('button', { name: 'Remove' }));
    expectRefused(panel, 2, BOUND_TABLE_WORDS.noteStands('depth'));
    // Still shown, its note's letter beside its header.
    expect(bodyOf(view)[0]).toEqual(['Site', 'Deptha']);
  });

  it('refuses a key typed that is not a value of its column, saying so', async () => {
    const user = userEvent.setup();
    const { panel } = await inTable(
      COLUMNS,
      {},
      holding(
        binding(),
        DECLARED,
        {},
        {
          key: ['visits'],
          rows: {},
        },
      ),
    );
    await user.click(within(panel).getByRole('button', { name: /^Notes/ }));
    const adding = within(panel).getByRole('group', { name: BOUND_TABLE_WORDS.addNote });
    await user.click(within(adding).getByRole('radio', { name: BOUND_TABLE_WORDS.noteOns.cell }));
    await user.type(within(adding).getByLabelText(BOUND_TABLE_WORDS.keyIs('visits')), 'two');
    await user.click(within(adding).getByRole('button', { name: BOUND_TABLE_WORDS.addNote }));
    expect(within(panel).getByRole('alert')).toHaveTextContent(
      BOUND_TABLE_WORDS.keyNeeded('visits'),
    );
  });

  it('offers a note on a column alone where the definition declares no key', async () => {
    const { panel } = await inTable(
      COLUMNS,
      {},
      holding(
        binding(),
        DECLARED,
        {},
        {
          key: [],
          rows: {},
        },
      ),
    );
    await userEvent.click(within(panel).getByRole('button', { name: /^Notes/ }));
    expect(panel).toHaveTextContent(BOUND_TABLE_WORDS.noKey);
    const on = within(panel).getByRole('radiogroup', { name: BOUND_TABLE_WORDS.noteOn });
    expect(on).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(within(on).getByRole('radio', { name: BOUND_TABLE_WORDS.noteOns.cell }));
    expect(
      within(on).getByRole('radio', { name: BOUND_TABLE_WORDS.noteOns.column }),
    ).toHaveAttribute('aria-checked', 'true');
  });

  it("sets Wide on the Bound table panel: the style's, Scale or Rotate", async () => {
    const user = userEvent.setup();
    const { view, panel, asked } = await inTable(COLUMNS);
    const wide = within(panel).getByLabelText(BOUND_TABLE_WORDS.wide);
    expect(wide).toHaveDisplayValue(BOUND_TABLE_WORDS.wides.style);
    await user.selectOptions(wide, 'rotate');
    expect(view.state.doc.lastChild!.attrs.wide).toBe('rotate');
    await waitFor(() =>
      expect(
        JSON.stringify(asked.filter((each) => each.route.startsWith('PUT')).at(-1)?.body),
      ).toContain('"wide":"rotate"'),
    );
  });

  it('has words for everything it says with no fancy dash', () => {
    const fancy = new RegExp(`[${String.fromCodePoint(0x2013, 0x2014)}]`);
    expect(JSON.stringify([BOUND_TABLE_WORDS, BOUND_TABLE_WORDS.keyIs('a')])).not.toMatch(fancy);
  });
});

describe("changing a bound table's binding (TB2-G)", () => {
  it('resolves it at once in a document, keeping a column the new definition lacks, shown as column_missing', async () => {
    const onSettle = vi.fn();
    // What the document holds once it has resolved the binding as changed: Visits, with no depth.
    const changed = holding(
      binding(VISITS),
      DECLARED.filter((each) => each.name !== 'depth'),
    );
    const { view } = await inTable(
      [
        { column: 'site', header: 'Site' },
        { column: 'depth', header: 'Depth' },
      ],
      { bindingActs: { pinned: false, onSettle } },
      changed,
    );
    const value = await screen.findByRole('region', { name: 'Value' });
    expect(value).toHaveTextContent('No rows - the binding changed since it was resolved');
    await userEvent.click(within(value).getByRole('button', { name: 'Change' }));
    const dialog = await screen.findByRole('dialog', { name: 'Value' });
    expect(within(dialog).queryByLabelText('Column')).toBeNull();
    await userEvent.click(await within(dialog).findByRole('radio', { name: /Visits/ }));
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Change' }));
    await waitFor(() => expect(onSettle).toHaveBeenCalledWith('k1', SESSION, 'changed'));
    expect(view.dom.querySelector('[data-bound-table-body]')).toHaveTextContent(
      'No rows - the result has no column depth',
    );
    expect(bodyOf(view)[0]).toEqual(['Site', 'Depth']);
  });
});
