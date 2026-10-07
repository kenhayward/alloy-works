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

  /** The page over one document placing the printer, its table holding a result of `rowCount` rows. */
  function opened(rowCount: number) {
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
          occurrences: [{ node: RESULTS, version: VERSION, mayEdit: false, lock: null }],
          versions: [{ id: VERSION, content }],
        });
      }
      if (path === `/v1/documents/${DOCUMENT}/bindings`) {
        return json(200, { bindings: [state(rowCount)] });
      }
      if (path === `/v1/documents/${DOCUMENT}/bindings/${RESULTS}/b1/rows`) {
        return json(200, {
          version: DATASET_VERSION,
          result: {
            columns: [
              ['site', 'text'],
              ['depth', 'decimal'],
            ],
            rows: Array.from({ length: rowCount }, (_, at) => [`S${at}`, `${at}.5`]),
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
          mayEdit: false,
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
});
