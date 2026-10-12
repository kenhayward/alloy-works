import { createApiClient } from '@alloy-works/api-client';
import { OUTLINE_SCHEMA_VERSION, defaultNumberingScheme } from '@alloy-works/domain';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { shimRangeMeasurement } from '../test/range.js';
import { BaselinePage } from './BaselinePage.js';

shimRangeMeasurement();

const DOCUMENT = 'dddddddd-0000-4000-8000-000000000001';
const BASELINE = 'bbbbbbbb-0000-4000-8000-000000000001';
const PRINTER = 'cccccccc-0000-4000-8000-000000000001';
const SHOWN = 'ssssssssssssssssssssssssss';
const HIDDEN = 'hhhhhhhhhhhhhhhhhhhhhhhhhh';
const base = { numbered: true, matter: 'body', pageBreak: 'none', values: {}, children: [] };

const view = {
  baseline: {
    id: BASELINE,
    document: DOCUMENT,
    name: 'As approved',
    madeBy: { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Ada' },
    madeAt: '2026-10-11T12:00:00.000Z',
    digest: 'a'.repeat(64),
    superseded: null,
  },
  version: { id: 'eeeeeeee-0000-4000-8000-000000000001', number: '0.4' },
  outline: {
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: 'The dosing report',
    language: 'en-GB',
    direction: 'ltr',
    nodes: [
      { type: 'reference', id: SHOWN, component: PRINTER, mode: { kind: 'latest' }, ...base },
      { type: 'reference', id: HIDDEN, component: null, mode: { kind: 'latest' }, ...base },
    ],
  },
  layout: {
    version: { id: 'ffffffff-0000-4000-8000-000000000001', number: '0.9' },
    scheme: defaultNumberingScheme,
    words: {},
  },
  texts: [
    {
      node: SHOWN,
      component: PRINTER,
      version: { id: 'cccccccc-0000-4000-8000-000000000009', number: '0.2' },
      title: 'Install the printer',
      content: {
        schemaVersion: 1,
        title: 'Install the printer',
        language: 'en-GB',
        direction: 'ltr',
        content: [
          {
            type: 'paragraph',
            id: 'p1',
            style: 'body',
            content: [{ type: 'text', value: 'Set the tray, as approved.', marks: [] }],
          },
        ],
      },
    },
  ],
  bindings: [],
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('a baseline at its own address', () => {
  it('STR-047 shows the document as the baseline holds it, at the node its address names, and nothing of a component the reader may not read', async () => {
    const asked: string[] = [];
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    render(
      <StrictMode>
        <BaselinePage
          client={createApiClient({
            baseUrl: 'http://acme.test',
            fetch: (async (input: Request) => {
              asked.push(new URL(input.url).pathname);
              return json(200, view);
            }) as unknown as typeof fetch,
          })}
          document={DOCUMENT}
          baseline={BASELINE}
          node={SHOWN}
        />
      </StrictMode>,
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'As approved' })).toBeVisible();
    expect(await screen.findByText('Set the tray, as approved.')).toBeInTheDocument();
    expect(screen.getByText('Version 0.4')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(document.querySelector(`[data-node="${SHOWN}"]`)).toHaveAttribute('data-marked', 'true');
    expect(scrolled).toHaveBeenCalled();
    expect(asked).toEqual(expect.arrayContaining([`/v1/baselines/${BASELINE}/view`]));
    // Only the baseline's view is read: never the document as it is now.
    expect(asked.every((path) => path === `/v1/baselines/${BASELINE}/view`)).toBe(true);
    expect(screen.getByRole('link', { name: 'Open the document as it is now' })).toHaveAttribute(
      'href',
      `#/documents/${DOCUMENT}`,
    );
  });

  it('says when there is no such baseline', async () => {
    render(
      <BaselinePage
        client={createApiClient({
          baseUrl: 'http://acme.test',
          fetch: (async () =>
            json(404, {
              code: 'not_found',
              message: 'x',
              traceId: 't',
            })) as unknown as typeof fetch,
        })}
        document={DOCUMENT}
        baseline={BASELINE}
        node={null}
      />,
    );
    expect(await screen.findByText('There is no such baseline.')).toBeInTheDocument();
  });

  it('COL-031 offers Review over the pinned text: threads listed against the baseline, and one started on the version it pins', async () => {
    const asked: { path: string; body: unknown }[] = [];
    const fetching = (async (input: Request) => {
      const path = new URL(input.url).pathname;
      const body = input.method === 'POST' ? await input.json() : null;
      asked.push({ path, body });
      if (path === `/v1/baselines/${BASELINE}/view`) {
        return json(200, {
          ...view,
          texts: view.texts.map((each) => ({ ...each, mayComment: true })),
          mayComment: false,
          mayReview: true,
        });
      }
      if (path === `/v1/baselines/${BASELINE}/threads`)
        return json(200, { threads: [], next: null });
      // What was sent is what this asks; the answer is the service's, not this page's.
      return json(409, { code: 'anchor_invalid', message: 'Not here.' });
    }) as unknown as typeof fetch;
    render(
      <BaselinePage
        client={createApiClient({ baseUrl: 'http://acme.test', fetch: fetching })}
        document={DOCUMENT}
        baseline={BASELINE}
        node={null}
      />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Review' }));
    const threads = await screen.findByRole('region', { name: 'Threads on this baseline' });
    await waitFor(() =>
      expect(asked.map((each) => each.path)).toContain(`/v1/baselines/${BASELINE}/threads`),
    );
    // Never the document's own list, which judges against the text as it is now.
    expect(asked.map((each) => each.path)).not.toContain(`/v1/documents/${DOCUMENT}/threads`);
    expect(within(threads).getByRole('combobox', { name: 'On' })).toHaveTextContent(
      'The whole of Install the printer',
    );
    await userEvent.type(
      within(threads).getByRole('textbox', { name: 'Comment' }),
      'Is this right?',
    );
    await userEvent.click(within(threads).getByRole('button', { name: 'Start thread' }));
    await waitFor(() =>
      expect(
        asked.find((each) => each.path === `/v1/components/${PRINTER}/threads`)?.body,
      ).toMatchObject({
        version: 'cccccccc-0000-4000-8000-000000000009',
        anchor: { kind: 'component' },
      }),
    );
  });
});
