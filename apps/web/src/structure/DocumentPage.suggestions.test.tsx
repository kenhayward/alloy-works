import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { opened } from '../editor/test/componentEditor.js';
import { DocumentPage } from './DocumentPage.js';
import {
  ADA,
  client,
  DOCUMENT,
  json,
  outline,
  PRINTER,
  reference,
  service,
} from './test/documentPage.js';

const REFERENCE = 'kkkkkkkkkkkkkkkkkkkkkkkkkk';
const VERSION = 'vvvvvvvv-0000-4000-8000-000000000001';
const SUGGESTION = 'gggggggg-0000-4000-8000-000000000001';
const printer = {
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    {
      type: 'paragraph',
      id: 'b1',
      style: 'body',
      content: [{ type: 'text', value: 'Unbox the printer.', marks: [] }],
    },
  ],
};

afterEach(() => {
  window.localStorage.removeItem('alloy-works.mode');
  window.sessionStorage.clear();
});

/** The document in Review, placing one component Ada may suggest to and edit. */
async function openInReview() {
  window.localStorage.setItem('alloy-works.mode', 'review');
  const fake = service(outline([reference(REFERENCE, 'latest')]), {
    mayEdit: true,
    mayComment: true,
    mayReview: true,
  });
  const asked: string[] = [];
  const sent: unknown[] = [];
  let suggestion: Record<string, unknown> | null = null;
  const fetching = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const path = url.pathname;
    asked.push(`${request.method} ${path}`);
    if (path === `/v1/documents/${DOCUMENT}/texts`) {
      return json(200, {
        document: DOCUMENT,
        version: { id: 'dddddddd-0000-4000-8000-000000000001', number: '0.1' },
        occurrences: [
          {
            node: REFERENCE,
            version: VERSION,
            mayEdit: true,
            mayComment: true,
            maySuggest: true,
            pendingSuggestions: suggestion === null ? 0 : 1,
            lock: null,
          },
        ],
        versions: [{ id: VERSION, content: printer }],
      });
    }
    if (path === `/v1/components/${PRINTER}` && request.method === 'GET') {
      return json(
        200,
        opened({
          id: PRINTER,
          content: printer,
          version: {
            id: VERSION,
            number: '0.2',
            author: ADA,
            createdAt: '2026-10-12T09:00:00.000Z',
            note: null,
          },
        }),
      );
    }
    if (path === `/v1/components/${PRINTER}/suggestions` && request.method === 'POST') {
      const body = (await request.json()) as { version: string; content: unknown };
      sent.push(body);
      suggestion = {
        id: SUGGESTION,
        component: PRINTER,
        madeAgainst: body.version,
        madeBy: { id: ADA, name: 'Ada' },
        madeAt: '2026-10-12T10:00:00.000Z',
        state: 'pending',
        stale: [],
        resolution: null,
        drawnOver: { version: VERSION, content: printer },
        drawn: body.content,
      };
      return json(200, suggestion);
    }
    if (path === `/v1/documents/${DOCUMENT}/suggestions`) {
      return json(200, { suggestions: suggestion === null ? [] : [suggestion], next: null });
    }
    if (path === `/v1/suggestions/${SUGGESTION}`) return json(200, suggestion);
    if (path === `/v1/suggestions/${SUGGESTION}/acceptance`) {
      suggestion = {
        ...suggestion!,
        state: 'accepted',
        stale: null,
        resolution: {
          by: { id: ADA, name: 'Ada' },
          at: '2026-10-12T10:05:00.000Z',
          version: 'vvvvvvvv-0000-4000-8000-000000000002',
        },
      };
      return json(200, suggestion);
    }
    if (path.startsWith('/v1/documents/') && path.endsWith('/threads')) {
      return json(200, { threads: [], next: null });
    }
    if (path === '/v1/people') return json(200, { items: [], next: null });
    return fake.fetch(request);
  }) as typeof globalThis.fetch;
  render(<DocumentPage client={client(fetching)} id={DOCUMENT} principalId={ADA} />);
  const text = await screen.findByRole('region', { name: "The document's text" });
  await within(text).findByText('Unbox the printer.');
  return { text, asked, sent };
}

describe('suggestions in Review (collaboration.md, Suggestions)', () => {
  it('COL-020 COL-025 drafts a suggestion in place with no lock, sends it, and lists it to be accepted', async () => {
    const { text, asked, sent } = await openInReview();
    await userEvent.click(
      await within(text).findByRole('button', { name: /^Suggest changes to / }),
    );
    // The draft opens in place, with Send and Discard, and no lock asked for. Its editing is the
    // editor's own test's (ComponentEditor.draft.test.tsx).
    await screen.findByRole('textbox', { name: 'Content of Install the printer' });
    expect(screen.getByRole('button', { name: 'Send suggestion' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ version: VERSION, content: { content: [{ id: 'b1' }] } });
    expect(asked.some((each) => each.endsWith('/lock'))).toBe(false);
    expect(asked.some((each) => each.includes('/iterations/'))).toBe(false);

    // The panel lists it; opened, it is drawn as a redline - nothing, here - and accepted.
    const panel = await screen.findByRole('tabpanel', { name: 'Suggestions' });
    await userEvent.click(await within(panel).findByRole('button', { name: /^Ada on / }));
    expect(
      await within(panel).findByRole('heading', { name: /^Ada's suggestion on / }),
    ).toBeInTheDocument();
    expect(within(panel).getByText('Nothing changed.')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Accept' }));
    expect(
      await within(panel).findByText(/^Ada's suggestion on .+ accepted\.$/),
    ).toBeInTheDocument();
    expect(asked).toContain(`POST /v1/suggestions/${SUGGESTION}/acceptance`);
  });

  it('CNT-137 announces a suggestion sent and accepted, naming whose and where, in status regions there from the start', async () => {
    const { text } = await openInReview();
    await userEvent.click(
      await within(text).findByRole('button', { name: /^Suggest changes to / }),
    );
    await screen.findByRole('textbox', { name: 'Content of Install the printer' });
    // The panel's region is there, empty, before anything is said in it.
    const panel = await screen.findByRole('tabpanel', { name: 'Suggestions' });
    expect(within(panel).getByRole('status')).toHaveTextContent('');
    await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }));
    // Said on the page's own status bar, naming where it was made.
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('status')
          .some((each) => each.textContent === 'Suggestion sent on 1 Install the printer.'),
      ).toBe(true),
    );
    await userEvent.click(await within(panel).findByRole('button', { name: /^Ada on / }));
    await userEvent.click(await within(panel).findByRole('button', { name: 'Accept' }));
    await waitFor(() =>
      expect(within(panel).getByRole('status')).toHaveTextContent(
        "Ada's suggestion on 1 Install the printer accepted.",
      ),
    );
  });
});
