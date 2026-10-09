import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';

import { shimRangeMeasurement } from '../test/range.js';
import { DEFAULT_PRESENTATION } from '../theme/presentation.fixture.js';
import { DocumentPage } from './DocumentPage.js';
import {
  ADA,
  client,
  DOCUMENT,
  INTRODUCTION,
  json,
  outline,
  PRINTER,
  referenceTo,
  RESULTS,
  section,
  service,
  SPACE,
} from './test/documentPage.js';

shimRangeMeasurement();

/**
 * A document's bound table on the page and in the Data tab (the TB2 plan, task 3; TB2-A, TB2-H): its
 * rows read through the rows route and laid out by the page, or its failures in place and on the
 * Data tab - `table_too_long` among them - without a rows fetch.
 */
describe("a document's bound table", () => {
  const DEFINITION = 'abcdef01-0000-4000-8000-000000000001';
  const DATASET = 'ssssssss-0000-4000-8000-000000000001';
  const DATASET_VERSION = 'ssssssss-0000-4000-8000-000000000002';
  const VERSION = 'vvvvvvvv-0000-4000-8000-000000000001';
  const decimal = { base: 'decimal', precision: 10, scale: 1 };
  const binding = {
    type: 'binding',
    id: 'b1',
    query: DEFINITION,
    parameters: {},
    mode: 'checked',
  };
  const noteOn = (id: string, site: string, words: string) => ({
    type: 'footnote',
    id,
    anchor: { kind: 'keyed', key: { site }, column: 'depth' },
    content: [
      {
        type: 'paragraph',
        id: `${id}p`,
        style: 'body',
        content: [{ type: 'text', value: words, marks: [] }],
      },
    ],
  });
  let notes: unknown[] = [];
  const content = {
    schemaVersion: 1,
    title: 'Install the printer',
    language: 'en-GB',
    direction: 'ltr',
    content: [
      {
        type: 'boundTable',
        id: 'bt1',
        style: 'table',
        binding,
        caption: [{ type: 'text', value: 'Readings by site', marks: [] }],
        columns: [
          { column: 'site', header: 'Site' },
          { column: 'depth', header: 'Depth', unit: { text: 'm', place: 'header' } },
        ],
        headerColumn: true,
        get notes() {
          return notes.length === 0 ? undefined : notes;
        },
      },
    ],
  };
  const provenance = (rowCount: number) => ({
    schemaVersion: 1,
    queryDefinition: { artifact: DEFINITION, version: 'abcdef01-0000-4000-8000-000000000002' },
    connection: null,
    parameters: {},
    ran: { sql: null },
    identity: { kind: 'service' },
    at: '2026-10-04T09:30:00.000Z',
    durationMs: 12,
    rowCount,
    columns: [
      { name: 'site', from: null, type: { base: 'text' } },
      { name: 'depth', from: null, type: decimal },
      { name: 'salary', from: null, type: decimal },
    ],
    canonical: 1,
    checksum: '0123456789abcdef'.repeat(4),
    images: {},
  });
  const state = (rowCount: number) => ({
    node: RESULTS,
    binding,
    held: {
      dataset: DATASET,
      version: DATASET_VERSION,
      number: '0.1',
      provenance: provenance(rowCount),
      key: ['site'],
      name: null,
      stale: false,
      taken: { table: true },
      act: 'resolve',
      keepable: false,
      by: { id: ADA, displayName: 'Ada' },
      at: '2026-10-04T09:31:00.000Z',
    },
    waiting: null,
    definition: { title: 'Readings', version: '0.2' },
    connection: null,
    definitionChanged: false,
    sincePublished: null,
    mayCheck: false,
    mayResolve: true,
  });

  /**
   * The page over one document placing the printer, its table holding a result of `rowCount` rows.
   * `editable`, Ada may edit it in place, and the rows route answers as the service does: from her
   * session's latest save where she names it, and from the version otherwise.
   */
  function opened(rowCount: number, editable = false, noted: unknown[] = []) {
    notes = noted;
    let savedContent: {
      content: {
        columns: { column: string }[];
        notes?: { id: string; anchor: { kind: string; key?: { site: string } } }[];
      }[];
    } | null = null;
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction', [referenceTo(RESULTS, PRINTER)])]),
    );
    const asked: string[] = [];
    const fetching = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      asked.push(`${url.pathname}${url.search}`);
      const path = url.pathname;
      if (path === `/v1/documents/${DOCUMENT}/presentation`) return json(200, DEFAULT_PRESENTATION);
      if (path === `/v1/documents/${DOCUMENT}/texts`) {
        return json(200, {
          document: DOCUMENT,
          version: { id: 'dddddddd-0000-4000-8000-000000000001', number: '0.1' },
          occurrences: [{ node: RESULTS, version: VERSION, mayEdit: editable, lock: null }],
          versions: [{ id: VERSION, content }],
        });
      }
      if (path === `/v1/documents/${DOCUMENT}/bindings`) {
        return json(200, { bindings: [state(rowCount)] });
      }
      if (path === `/v1/documents/${DOCUMENT}/bindings/${RESULTS}/b1/rows`) {
        const fromSession = url.searchParams.has('session') && savedContent !== null;
        const named = new Set(
          (fromSession ? savedContent! : content).content[0]!.columns.map((each) => each.column),
        );
        const all: [string, string][] = [
          ['site', 'text'],
          ['depth', 'decimal'],
          ['salary', 'decimal'],
        ];
        const at = all.flatMap((column, index) => (named.has(column[0]) ? [index] : []));
        // Each keyed note's row by its site, as the service matches it (TB3-C).
        const table = (fromSession ? savedContent! : content).content[0]! as {
          notes?: { id: string; anchor: { kind: string; key?: { site: string } } }[];
        };
        const noteRows = Object.fromEntries(
          (table.notes ?? []).flatMap((each) => {
            if (each.anchor.kind !== 'keyed') return [];
            const row = Number(each.anchor.key!.site.slice(1));
            return [
              [each.id, each.anchor.key!.site.startsWith('S') && row < rowCount ? row : null],
            ];
          }),
        );
        return json(200, {
          version: DATASET_VERSION,
          presorted: !fromSession,
          result: {
            columns: at.map((index) => all[index]!),
            rows: Array.from({ length: rowCount }, (_, row) =>
              at.map((index) => [`S${row}`, `${row}.5`, `${row + 1}000`][index]!),
            ),
          },
          notes: noteRows,
        });
      }
      if (path === `/v1/components/${PRINTER}/lock` && request.method === 'POST') {
        const { session } = (await request.json()) as { session: string };
        return json(200, {
          lock: {
            holder: { id: ADA, name: 'Ada' },
            expectedRelease: '2026-10-07T09:15:00.000Z',
            yours: true,
            session,
          },
        });
      }
      const saving = new RegExp(`^/v1/components/${PRINTER}/iterations/([^/]+)/(\\d+)$`).exec(path);
      if (saving && request.method === 'PUT') {
        savedContent = ((await request.json()) as { content: typeof savedContent }).content;
        return json(200, {
          sequence: Number(saving[2]),
          lock: {
            holder: { id: ADA, name: 'Ada' },
            expectedRelease: '2026-10-07T09:15:00.000Z',
            yours: true,
            session: saving[1],
          },
        });
      }
      if (path === `/v1/components/${PRINTER}`) {
        return json(200, {
          id: PRINTER,
          space: { id: SPACE, name: 'General' },
          version: {
            id: VERSION,
            number: '0.3',
            author: ADA,
            createdAt: '2026-09-18T09:00:00.000Z',
            note: null,
          },
          content,
          mayEdit: editable,
          lock: null,
          type: { id: 'type-topic', name: 'Topic' },
          fields: [],
          schemas: [],
          values: {},
        });
      }
      return fake.fetch(request);
    }) as typeof globalThis.fetch;
    render(
      <StrictMode>
        <DocumentPage client={client(fetching)} id={DOCUMENT} principalId={ADA} />
      </StrictMode>,
    );
    return { asked };
  }

  const textRegion = () => screen.findByRole('region', { name: "The document's text" });
  const rowsAsked = (asked: readonly string[]) => asked.filter((each) => each.includes('/rows'));

  it('draws its first rows from the rows route, once, laid out by the page', async () => {
    const { asked } = opened(60);
    const text = await textRegion();
    // Drawn once the values and the rows have arrived; until then its headers and what it waits on.
    await within(text).findByRole('rowheader', { name: 'S0' });
    const grid = within(text).getByRole('table', { name: 'Readings by site' });
    expect(
      within(grid)
        .getAllByRole('columnheader')
        .map((each) => each.textContent),
    ).toEqual(['Site', 'Depth (m)']);
    expect(within(grid).getByRole('rowheader', { name: 'S0' })).toBeInTheDocument();
    expect(within(grid).getByRole('cell', { name: '0.5' })).toBeInTheDocument();
    expect(within(grid).getAllByRole('row')).toHaveLength(51);
    expect(within(text).getByText('and 10 more rows')).toBeInTheDocument();
    expect(rowsAsked(asked)).toEqual([
      `/v1/documents/${DOCUMENT}/bindings/${RESULTS}/b1/rows?version=${DATASET_VERSION}`,
    ]);
  });

  it("draws a keyed note's letter in its cell and its words beneath, and a note whose row is gone in place and on the Data tab (TB3.3)", async () => {
    const user = userEvent.setup();
    opened(3, false, [noteOn('f1', 'S1', 'Estimated'), noteOn('f2', 'S9', 'Closed')]);
    const text = await textRegion();
    const grid = await within(text).findByRole('table', { name: 'Readings by site' });
    expect(grid).toBeInTheDocument();
    await waitFor(() =>
      expect(text.querySelectorAll('[data-bound-table-body] tr')[2]?.textContent).toBe('S11.5a'),
    );
    const beneath = [...text.querySelectorAll<HTMLElement>('[data-bound-table-note]')];
    expect(beneath.map((each) => each.textContent)).toEqual([
      'aEstimated',
      'No row has the key site S9 nowClosed',
    ]);
    expect(beneath[1]).toHaveClass('aw-binding-failed');
    await user.click(await screen.findByRole('tab', { name: 'Data' }));
    const panel = screen.getByRole('tabpanel', { name: 'Data' });
    const row = panel.querySelector('[data-binding="b1"]')!;
    expect(row.querySelector('[data-state]')).toHaveAttribute('data-state', 'failed');
    expect(row).toHaveTextContent(
      'A note on this table names the row with the key {"site":"S9"}, which its result no longer has.',
    );
  });

  it('reads the rows again with the note added in the editor open in place, its letter drawn once its session has saved it (TB3.3)', async () => {
    const user = userEvent.setup();
    const { asked } = opened(3, true);
    const text = await textRegion();
    await within(text).findByRole('rowheader', { name: 'S0' });
    await user.click(within(text).getByText('Readings by site'));
    const surface = await within(text).findByRole('textbox', {
      name: 'Content of Install the printer',
    });
    const panel = await screen.findByRole('group', { name: 'Bound table' });
    await user.click(within(panel).getByRole('tab', { name: /^Notes/ }));
    const adding = within(panel).getByRole('group', { name: 'Add note' });
    await user.click(within(adding).getByRole('radio', { name: 'A cell, by its row' }));
    await user.selectOptions(within(adding).getByLabelText('Column'), 'depth');
    await user.type(within(adding).getByLabelText('Where site is'), 'S2');
    await user.click(within(adding).getByRole('button', { name: 'Add note' }));
    await user.keyboard('Dredged');
    const before = rowsAsked(asked).length;
    await waitFor(
      () =>
        expect([...surface.querySelectorAll('[data-bound-table-body] tr')][3]?.textContent).toBe(
          'S22.5a',
        ),
      { timeout: 8_000 },
    );
    expect(rowsAsked(asked).length).toBeGreaterThan(before);
    expect(surface.querySelector('[data-bound-table-note]')).toHaveTextContent('aDredged');
  }, 20_000);

  it('shows table_too_long in place and on the Data tab without fetching a row, its state failed', async () => {
    const user = userEvent.setup();
    const { asked } = opened(2_001);
    const text = await textRegion();
    await waitFor(() =>
      expect(text.querySelector('[data-bound-table-body]')).toHaveTextContent(
        'No rows - the result has 2001 rows, more than a table prints',
      ),
    );
    expect(text.querySelector('[data-bound-table-body]')).toHaveClass('aw-binding-failed');
    await user.click(await screen.findByRole('tab', { name: 'Data' }));
    const panel = screen.getByRole('tabpanel', { name: 'Data' });
    const row = panel.querySelector('[data-binding="b1"]')!;
    expect(row).toHaveTextContent('A table of 2001 rows');
    expect(row.querySelector('[data-state]')).toHaveAttribute('data-state', 'failed');
    expect(row).toHaveTextContent(
      "This table's result has 2001 rows, more than a table can print. Narrow the rows in its query.",
    );
    expect(rowsAsked(asked)).toEqual([]);
  });

  it('draws a column added in the editor open in place once its session has saved it, never sticking at reading its rows (the TB2 final review)', async () => {
    const user = userEvent.setup();
    const { asked } = opened(3, true);
    const text = await textRegion();
    await within(text).findByRole('rowheader', { name: 'S0' });
    await user.click(within(text).getByText('Readings by site'));
    const surface = await within(text).findByRole('textbox', {
      name: 'Content of Install the printer',
    });
    // Opened where the caption was clicked, so the panel shapes its table.
    const panel = await screen.findByRole('group', { name: 'Bound table' });
    await waitFor(() =>
      expect(within(panel).getByRole('button', { name: 'Add column' })).toHaveAttribute(
        'aria-disabled',
        'false',
      ),
    );
    await user.click(within(panel).getByRole('button', { name: 'Add column' }));
    const body = () => surface.querySelector('[data-bound-table-body]')!;
    // Read once the session has saved it, with that session, and drawn: not stuck reading.
    const firstRow = () =>
      [...(body().querySelectorAll('tr')[1]?.querySelectorAll('th, td') ?? [])].map(
        (cell) => cell.textContent,
      );
    expect(body()).toHaveTextContent('Reading the rows');
    await waitFor(() => expect(firstRow()).toEqual(['S0', '0.5', '1,000.0']), { timeout: 8_000 });
    expect(
      within(body() as HTMLElement).getByRole('columnheader', { name: 'salary' }),
    ).toBeInTheDocument();
    expect(rowsAsked(asked).some((each) => each.includes('session='))).toBe(true);
  }, 20_000);
});
