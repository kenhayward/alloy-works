import { createApiClient } from '@alloy-works/api-client';
import {
  compareContent,
  compareOutlines,
  OUTLINE_SCHEMA_VERSION,
  type ContentDocument,
  type OutlineDocument,
  type OutlineNode,
} from '@alloy-works/domain';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BaselineComparisonPage } from './BaselineComparisonPage.js';

const DOCUMENT = 'dddddddd-0000-4000-8000-000000000001';
const BASELINE = 'bbbbbbbb-0000-4000-8000-000000000001';
const PRINTER = 'cccccccc-0000-4000-8000-000000000001';
const TRAY = 'cccccccc-0000-4000-8000-000000000002';
const A = 'a'.repeat(26);
const B = 'b'.repeat(26);
const W = 'w'.repeat(26);

const base = {
  numbered: true,
  matter: 'body',
  pageBreak: 'none',
  values: {},
  children: [],
} as const;
const reference = (id: string, component: string | null): OutlineNode =>
  ({
    type: 'reference',
    id,
    component,
    mode: { kind: 'latest' },
    ...base,
  }) as unknown as OutlineNode;
const outline = (...nodes: OutlineNode[]): OutlineDocument => ({
  schemaVersion: OUTLINE_SCHEMA_VERSION,
  title: 'Report',
  language: 'en-GB',
  direction: 'ltr',
  nodes,
});
const docOf = (value: string): ContentDocument => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    { type: 'paragraph', id: 'p1', style: 'body', content: [{ type: 'text', value, marks: [] }] },
  ],
});
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const older = outline(reference(A, PRINTER), reference(W, null));
const newer = outline(reference(A, PRINTER), reference(W, null), reference(B, TRAY));
const printerBefore = docOf('Set the tray.');
const printerAfter = docOf('Set the tray firmly.');
const view = {
  older: {
    baseline: { id: BASELINE, name: 'Issue 1' },
    version: { id: 'v1', number: '0.3' },
    outline: older,
  },
  newer: { baseline: null, version: { id: 'v2', number: '0.4' }, outline: newer },
  structure: compareOutlines(older, newer).changes,
  titles: [
    { node: A, title: 'Install the printer' },
    { node: B, title: 'Load the tray' },
  ],
  components: [
    {
      node: A,
      component: PRINTER,
      from: { id: 'c1', number: '0.2' },
      to: { id: 'c2', number: '0.3' },
      older: printerBefore,
      newer: printerAfter,
      changes: compareContent(printerBefore, printerAfter).changes,
    },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('two baselines compared, at their own address', () => {
  it('VER-024 VER-030 VER-031 shows the structure and each component changed as redlines, and exports them as one HTML file holding nothing withheld', async () => {
    const saved: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      saved.push(blob);
      return 'blob:redline';
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(
      <BaselineComparisonPage
        client={createApiClient({
          baseUrl: 'http://acme.test',
          fetch: (async (input: Request) =>
            new URL(input.url).pathname.endsWith('/resolved')
              ? json(200, {
                  document: ['theme'],
                  nodes: [
                    {
                      node: A,
                      title: 'Install the printer',
                      causes: ['data'],
                      values: [{ binding: 'depth', older: '3.5', newer: '3.75' }],
                    },
                  ],
                })
              : json(200, view)) as unknown as typeof fetch,
        })}
        document={DOCUMENT}
        baseline={BASELINE}
        against="now"
      />,
    );
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Issue 1 compared with the document now (0.4)',
      }),
    ).toBeInTheDocument();
    const structure = screen.getByRole('list', { name: 'Changes to the structure' });
    expect(within(structure).getByText('Added')).toBeInTheDocument();
    expect(structure.querySelector('ins')).toHaveTextContent('Load the tray');
    const printer = screen.getByRole('list', { name: 'Changes to Install the printer' });
    expect(printer.querySelector('ins')).toHaveTextContent('firmly');

    // What prints differently, and why: here, data nobody typed, and the theme for the whole.
    const printed = await screen.findByRole('list', { name: 'What prints differently' });
    expect(printed).toHaveTextContent('Install the printer: Its data changed');
    expect(printed).toHaveTextContent('depth: Was: 3.5 to Now: 3.75');
    expect(screen.getByText('For the whole document, the theme changed.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    const html = await saved[0]!.text();
    expect(html).toContain('<title>Issue 1 compared with the document now (0.4)</title>');
    expect(html).toContain('Load the tray');
    expect(html).toContain('firmly');
    // The withheld reference is a node alone: nothing of its component reaches the export.
    expect(html).not.toContain('null');
  });
});
