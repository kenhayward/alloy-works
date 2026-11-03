import type { StreamPostOptions } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
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
const THREAD = 'tttttttt-0000-4000-8000-000000000001';
const PROPOSAL = 'cccccccc-0000-4000-8000-0000000000d2';
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
  try {
    window.localStorage.removeItem('alloy-works.mode');
  } catch {
    // Storage refused: nothing was kept.
  }
  window.getSelection()?.removeAllRanges();
});

/**
 * The document, placing one component, opened by a reader who may or may not edit, comment on the
 * document, or comment on the component; its threads answered from a list the test holds.
 */
async function openAs(may: {
  edit?: boolean;
  review?: boolean;
  component?: boolean;
  mode?: 'review';
  /** A thread already on the component, which the address opens Review at. */
  at?: boolean;
  /** A thread already on the component, and no address. */
  held?: boolean;
  /** That thread resolved. */
  resolved?: boolean;
}) {
  if (may.mode) window.localStorage.setItem('alloy-works.mode', may.mode);
  const fake = service(outline([reference(REFERENCE, 'latest')]), {
    mayEdit: may.edit ?? false,
    mayComment: may.review ?? false,
    mayReview: may.review ?? false,
  });
  const component = PRINTER;
  const started: unknown[] = [];
  const threads: unknown[] = [];
  const onComponent = {
    id: THREAD,
    on: { id: component, kind: 'component' },
    anchor: { kind: 'component' },
    madeAgainst: VERSION,
    startedBy: { id: ADA, name: 'Ada' },
    startedAt: '2026-10-12T10:00:00.000Z',
  };
  const thread = {
    ...onComponent,
    resolvedAt: may.resolved ? '2026-10-12T11:00:00.000Z' : null,
    comments: 1,
    said: [{ text: 'Which tray?' }],
    lastAt: '2026-10-12T10:00:00.000Z',
    participants: [{ id: ADA, name: 'Ada' }],
    mentioned: [],
    words: 'Which tray?',
    drafted: false,
    new: false,
    orphaned: false,
    places: [{ node: REFERENCE, orphaned: false }],
  };
  if (may.at || may.held) threads.push(thread);
  const fetching = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(request.url).pathname;
    if (path === `/v1/documents/${DOCUMENT}/texts`) {
      return json(200, {
        document: DOCUMENT,
        version: { id: 'dddddddd-0000-4000-8000-000000000001', number: '0.1' },
        occurrences: [
          {
            node: REFERENCE,
            version: VERSION,
            mayEdit: may.edit ?? false,
            mayComment: may.component ?? false,
            lock: null,
          },
        ],
        versions: [{ id: VERSION, content: printer }],
      });
    }
    if (path === `/v1/documents/${DOCUMENT}/threads`) return json(200, { threads, next: null });
    if (path === `/v1/components/${component}/threads` && request.method === 'POST') {
      const body = (await request.json()) as { anchor: unknown; version: string };
      started.push(body);
      const thread = {
        id: THREAD,
        on: { id: component, kind: 'component' },
        anchor: body.anchor,
        madeAgainst: VERSION,
        startedBy: { id: ADA, name: 'Ada' },
        startedAt: '2026-10-12T10:00:00.000Z',
        resolvedAt: null,
        comments: 1,
        said: [{ text: 'Which box?' }],
        participants: [{ id: ADA, name: 'Ada' }],
        mentioned: [],
        words: '',
        drafted: false,
        new: false,
        lastAt: '2026-10-12T10:00:00.000Z',
        orphaned: false,
        places: [{ node: REFERENCE, orphaned: false }],
      };
      threads.push(thread);
      return json(200, {
        ...thread,
        resolution: null,
        comments: [
          {
            id: 'cccccccc-0000-4000-8000-0000000000c1',
            author: { id: ADA, name: 'Ada' },
            at: '2026-10-12T10:00:00.000Z',
            texts: [{ parts: [{ text: 'Which box?' }], at: '2026-10-12T10:00:00.000Z' }],
          },
        ],
        untold: [],
      });
    }
    if (path === '/v1/people') return json(200, { items: [], next: null });
    if (request.method === 'POST' && path === '/v1/conversations') {
      return json(200, {
        conversation: {
          id: 'cccccccc-0000-4000-8000-0000000000d1',
          document: DOCUMENT,
          title: 'Asked',
          madeAt: '2026-10-12T10:00:00.000Z',
          kept: false,
          turns: [],
        },
      });
    }
    if (path === '/v1/conversations' || path === '/v1/conversation-endpoints') {
      return json(200, { items: [] });
    }
    if (path === `/v1/assistant/proposals/${PROPOSAL}/acceptance`) {
      threads.push(thread);
      return json(200, {
        proposal: { id: PROPOSAL, state: 'accepted', suggestion: null, thread: THREAD },
      });
    }
    if (path === `/v1/threads/${THREAD}` && request.method === 'GET') {
      return json(200, {
        ...onComponent,
        resolution: null,
        comments: [
          {
            id: 'cccccccc-0000-4000-8000-0000000000c2',
            author: { id: ADA, name: 'Ada' },
            at: '2026-10-12T10:00:00.000Z',
            texts: [{ parts: [{ text: 'Which tray?' }], at: '2026-10-12T10:00:00.000Z' }],
          },
        ],
      });
    }
    return fake.fetch(request);
  }) as typeof globalThis.fetch;
  const shown = render(
    <DocumentPage
      client={client(fetching)}
      id={DOCUMENT}
      principalId={ADA}
      assistantStream={proposing}
      atPanel={may.at ? { panel: 'threads', arrival: 0, thread: THREAD } : null}
    />,
  );
  const text = await screen.findByRole('region', { name: "The document's text" });
  await within(text).findByText('Unbox the printer.');
  return { text, shown, started };
}
const modeOf = () => screen.getByRole('radiogroup', { name: 'Mode' });

/** A turn that proposes a comment on the component, and ends. */
const proposing = async (options: StreamPostOptions) => {
  options.onEvent('run', { run: 'r1', endpoint: { name: 'Drafting', boundary: 'inside' } });
  options.onEvent('proposal', {
    id: PROPOSAL,
    number: 1,
    component: PRINTER,
    against: VERSION,
    comment: { text: 'Which tray?', quote: null },
    proposed: { content: [] },
  });
  options.onEvent('ended', {
    outcome: 'finished',
    model: 'stand-in-1',
    tokensIn: 1,
    tokensOut: 1,
    cost: '0',
    currency: 'USD',
    citations: [],
    dropped: [],
  });
  return { kind: 'streamed' as const };
};

const panelsTab = (name: string) =>
  within(screen.getByRole('tablist', { name: 'Document panels' })).getByRole('tab', { name });

describe('Review (collaboration.md, "Review mode")', () => {
  it('CNT-155 IAM-081 offers Review beside Reading and Authoring to whoever may comment, and to nobody else', async () => {
    // Somebody who may comment on the document and edit it: all three, in order.
    const first = await openAs({ edit: true, review: true });
    expect(
      within(modeOf())
        .getAllByRole('radio')
        .map((each) => each.parentElement?.textContent),
    ).toEqual(['Reading', 'Review', 'Authoring']);
    first.shown.unmount();
    // A reader who may comment on a component the document places: Reading and Review.
    const second = await openAs({ component: true });
    expect(
      within(modeOf())
        .getAllByRole('radio')
        .map((each) => each.parentElement?.textContent),
    ).toEqual(['Reading', 'Review']);
    second.shown.unmount();
    // A reader who may do neither: no switch at all.
    await openAs({});
    expect(screen.queryByRole('radiogroup', { name: 'Mode' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Threads' })).toBeNull();
  });

  it('CNT-157 shows the text with no editing surface and the threads beside it, and starts a thread on what the reader selects', async () => {
    const { text, started } = await openAs({ edit: true, review: true, component: true });
    await userEvent.click(within(modeOf()).getByRole('radio', { name: 'Review' }));
    expect(screen.getByRole('article', { name: /in Review$/ })).toBeInTheDocument();
    // The text as Reading shows it: nothing opens an editor, nothing restructures the outline.
    const body = within(text).getByText('Unbox the printer.');
    expect(body.closest('[data-opens]')).toBeNull();
    expect(text.querySelector('[contenteditable="true"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add section' })).toBeNull();
    await userEvent.click(body);
    expect(text.querySelector('[contenteditable="true"]')).toBeNull();
    // The threads beside it.
    const panel = await screen.findByRole('tabpanel', { name: 'Threads' });
    expect(await within(panel).findByText('No threads here.')).toBeInTheDocument();

    // The reader selects words of the component's text: the panel offers a thread on them.
    const words = body.firstChild!;
    const range = document.createRange();
    range.setStart(words, 6);
    range.setEnd(words, 17);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    const on = await within(panel).findByLabelText('On');
    await waitFor(() =>
      expect(
        within(on).getByRole('option', { name: 'The selected text “the printer”' }),
      ).toBeInTheDocument(),
    );
    await userEvent.type(within(panel).getByLabelText('Comment'), 'Which box?');
    await userEvent.click(within(panel).getByRole('button', { name: 'Start thread' }));
    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]).toMatchObject({
      version: VERSION,
      anchor: { kind: 'span', block: 'b1', quote: 'the printer', before: 'Unbox ' },
      parts: [{ text: 'Which box?' }],
    });
    // And the text marks where it stands.
    await waitFor(() =>
      expect(text.querySelector('mark[data-thread]')).toHaveTextContent('the printer'),
    );
    // And a selection in text already marked holds: the text is not drawn again under it.
    await userEvent.click(within(panel).getByRole('button', { name: 'All threads' }));
    const marked = text.querySelector('mark[data-thread]')!.previousSibling!;
    const again = document.createRange();
    again.setStart(marked, 0);
    again.setEnd(marked, 5);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(again);
    document.dispatchEvent(new Event('selectionchange'));
    await waitFor(() =>
      expect(
        within(within(panel).getByLabelText('On')).getByRole('option', {
          name: 'The selected text “Unbox”',
        }),
      ).toBeInTheDocument(),
    );
    expect(window.getSelection()!.toString()).toBe('Unbox');
  });

  it('opens in Review at the thread an address names, and remembers neither', async () => {
    await openAs({ review: true, component: true, at: true });
    expect(within(modeOf()).getByRole('radio', { name: 'Review' })).toBeChecked();
    const panel = await screen.findByRole('tabpanel', { name: 'Threads' });
    expect(await within(panel).findByText('Which tray?')).toBeInTheDocument();
    expect(window.localStorage.getItem('alloy-works.mode')).toBeNull();
  });

  it('shows the threads in Authoring too, to read and answer, starting none there', async () => {
    await openAs({ edit: true, review: true, component: true, held: true });
    await userEvent.click(within(modeOf()).getByRole('radio', { name: 'Authoring' }));
    await userEvent.click(panelsTab('Threads'));
    const panel = screen.getByRole('tabpanel', { name: 'Threads' });
    expect(await within(panel).findByText(/1 comment/)).toBeVisible();
    expect(within(panel).queryByRole('button', { name: 'Start thread' })).toBeNull();
    // Beside the text it stands on, as in Review.
    expect(screen.getByRole('article', { name: /in Authoring$/ })).toBeInTheDocument();
  });

  it('marks a component’s open comment in its gutter, saying it on hover, and opens it in the Threads panel', async () => {
    const { text } = await openAs({ edit: true, review: true, component: true, held: true });
    await userEvent.click(within(modeOf()).getByRole('radio', { name: 'Authoring' }));
    const glyph = await within(text).findByRole('button', {
      name: 'Open the comment: Which tray?',
    });
    expect(glyph).toHaveAttribute('title', 'Which tray?');
    await userEvent.click(glyph);
    expect(panelsTab('Threads')).toHaveAttribute('aria-selected', 'true');
    const panel = screen.getByRole('tabpanel', { name: 'Threads' });
    expect(await within(panel).findByText('Which tray?')).toBeVisible();
  });

  it('marks no resolved comment in the gutter', async () => {
    const { text } = await openAs({
      edit: true,
      review: true,
      component: true,
      held: true,
      resolved: true,
    });
    await userEvent.click(within(modeOf()).getByRole('radio', { name: 'Authoring' }));
    await userEvent.click(panelsTab('Threads'));
    await within(screen.getByRole('tabpanel', { name: 'Threads' })).findByText('No threads here.');
    expect(within(text).queryByRole('button', { name: /Open the comment/ })).toBeNull();
  });

  it('leaves Suggestions and Rounds to Review', async () => {
    await openAs({ edit: true, review: true, component: true });
    await userEvent.click(within(modeOf()).getByRole('radio', { name: 'Authoring' }));
    const tabs = screen.getByRole('tablist', { name: 'Document panels' });
    expect(within(tabs).queryByRole('tab', { name: 'Suggestions' })).toBeNull();
    expect(within(tabs).queryByRole('tab', { name: 'Rounds' })).toBeNull();
  });

  it('lists a comment the assistant posted as it is accepted, without leaving Authoring', async () => {
    await openAs({ edit: true, review: true, component: true });
    await userEvent.click(within(modeOf()).getByRole('radio', { name: 'Authoring' }));
    await userEvent.click(panelsTab('Assistant'));
    await userEvent.type(await screen.findByLabelText('Ask the assistant'), 'Flag it.');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    const proposal = await screen.findByRole('article', { name: 'Proposal 1' });
    await userEvent.click(within(proposal).getByRole('button', { name: 'Accept' }));
    await within(proposal).findByText('Accepted: the comment is posted, as yours.');
    await userEvent.click(panelsTab('Threads'));
    const panel = screen.getByRole('tabpanel', { name: 'Threads' });
    expect(await within(panel).findByText(/1 comment/)).toBeVisible();
  });

  it('keeps Review as the reader’s choice for the next document', async () => {
    const { shown } = await openAs({ review: true, mode: 'review' });
    expect(within(modeOf()).getByRole('radio', { name: 'Review' })).toBeChecked();
    expect(screen.getByRole('tab', { name: 'Threads' })).toBeInTheDocument();
    shown.unmount();
  });
});
