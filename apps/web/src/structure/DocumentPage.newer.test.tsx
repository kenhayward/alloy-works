import { compareContent, type ContentDocument } from '@alloy-works/domain';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { OutlineNode } from '@alloy-works/domain';
import type { StreamPostOptions } from '@alloy-works/api-client';
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
const PINNED = 'bbbbbbbb-0000-4000-8000-000000000002';
const NEWER = 'bbbbbbbb-0000-4000-8000-000000000003';
const CONVERSATION = 'cccccccc-0000-4000-8000-000000000001';
const PROPOSAL = 'cccccccc-0000-4000-8000-000000000002';
const printer = (value: string): ContentDocument => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    { type: 'paragraph', id: 'b1', style: 'body', content: [{ type: 'text', value, marks: [] }] },
  ],
});

/** The document, placing the printer pinned at 0.2 while 0.3 is its latest, `newer` saying so or not. */
async function openPinned({
  newer,
  failing = false,
  mayEdit,
}: {
  newer: boolean;
  failing?: boolean;
  mayEdit?: boolean;
}) {
  // What the texts route names as newer: a test may move it on, as another author's version would.
  const latest = { id: NEWER, number: '0.3' };
  const pinned = {
    ...reference(REFERENCE, 'latest'),
    mode: { kind: 'pinned', version: PINNED },
  } as OutlineNode;
  const fake = service(outline([pinned]), mayEdit === undefined ? {} : { mayEdit });
  const asked: string[] = [];
  const fetching = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    asked.push(`${request.method} ${url.pathname}${url.search}`);
    if (url.pathname === `/v1/documents/${DOCUMENT}/texts`) {
      return json(200, {
        document: DOCUMENT,
        version: { id: 'dddddddd-0000-4000-8000-000000000001', number: '0.1' },
        occurrences: [
          {
            node: REFERENCE,
            version: PINNED,
            mayEdit: mayEdit === false,
            mayComment: false,
            maySuggest: false,
            pendingSuggestions: 0,
            lock: null,
            ...(newer ? { newer: { ...latest } } : {}),
          },
        ],
        versions: [{ id: PINNED, number: '0.2', content: printer('Unbox the printer.') }],
      });
    }
    if (url.pathname === `/v1/components/${PRINTER}/comparison`) {
      if (failing) return json(500, { code: 'internal', message: 'Something went wrong.' });
      const older = printer('Unbox the printer.');
      const newerContent = printer('Unbox the printer carefully.');
      return json(200, {
        component: PRINTER,
        from: { id: PINNED, number: '0.2' },
        to: { id: NEWER, number: '0.3' },
        older,
        newer: newerContent,
        changes: compareContent(older, newerContent).changes,
      });
    }
    if (request.method === 'POST' && url.pathname === '/v1/conversations') {
      return json(200, {
        conversation: {
          id: CONVERSATION,
          document: DOCUMENT,
          title: 'Asked',
          madeAt: '2026-11-02T10:00:00.000Z',
          kept: false,
          turns: [],
        },
      });
    }
    if (url.pathname === '/v1/conversations') return json(200, { items: [] });
    if (url.pathname === '/v1/conversation-endpoints') return json(200, { items: [] });
    if (url.pathname.endsWith(`/proposals/${PROPOSAL}/acceptance`)) {
      return json(200, {
        proposal: { id: PROPOSAL, state: 'accepted', suggestion: 'x', version: NEWER },
      });
    }
    return fake.fetch(request);
  }) as typeof globalThis.fetch;
  render(
    <DocumentPage
      client={client(fetching)}
      id={DOCUMENT}
      principalId={ADA}
      assistantStream={proposing}
    />,
  );
  const text = await screen.findByRole('region', { name: "The document's text" });
  await within(text).findByText('Unbox the printer.');
  return { text, asked, latest, fake };
}

/** A turn that proposes an edit of the printer, and ends. */
const proposing = async (options: StreamPostOptions) => {
  options.onEvent('run', { run: 'r1', endpoint: { name: 'Drafting', boundary: 'inside' } });
  options.onEvent('proposal', {
    id: PROPOSAL,
    number: 1,
    component: PRINTER,
    against: PINNED,
    proposed: printer('Unbox the printer carefully.'),
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

/** Asks the Assistant in Authoring, and accepts what it proposes. */
async function acceptProposal() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('radio', { name: 'Authoring' }));
  await user.click(await screen.findByRole('tab', { name: 'Assistant' }));
  await user.type(await screen.findByLabelText('Ask the assistant'), 'Say carefully.');
  await user.click(screen.getByRole('button', { name: 'Ask' }));
  const proposal = await screen.findByRole('article', { name: 'Proposal 1' });
  await user.click(within(proposal).getByRole('button', { name: 'Accept' }));
  return proposal;
}

describe('a reference pinned below a newer version (document-view.md, Versions)', () => {
  afterEach(() => {
    try {
      window.localStorage.removeItem('alloy-works.mode');
    } catch {
      // Storage refused: nothing was kept.
    }
  });

  it('moves the pin to the version an accepted edit made, and says so (issue #902)', async () => {
    const { fake } = await openPinned({ newer: true });
    const proposal = await acceptProposal();
    await within(proposal).findByText(
      'Accepted: this document now shows the new version. Undo in the outline takes it back.',
    );
    expect(fake.edits().map((each) => each.body)).toEqual([
      expect.objectContaining({
        operation: { operation: 'set', node: REFERENCE, mode: { kind: 'pinned', version: NEWER } },
      }),
    ]);
  });

  it('leaves the pin where the person may not change the document, and says so (issue #902)', async () => {
    const { fake } = await openPinned({ newer: true, mayEdit: false });
    const proposal = await acceptProposal();
    await within(proposal).findByText(
      'Accepted: it is a new version of the part. This document still shows the version it had.',
    );
    expect(fake.edits()).toEqual([]);
  });

  it('CNT-181 says a newer version exists, naming it, and compares the two when asked, asking nothing until then', async () => {
    const { text, asked } = await openPinned({ newer: true });
    expect(within(text).getByText('Version 0.3 is newer than the 0.2 pinned here.')).toBeVisible();
    expect(asked.some((each) => each.includes('/comparison'))).toBe(false);
    await userEvent.click(within(text).getByRole('button', { name: 'Compare 0.2 with 0.3' }));
    await waitFor(() =>
      expect(asked).toContain(
        `GET /v1/components/${PRINTER}/comparison?from=${PINNED}&to=${NEWER}`,
      ),
    );
    const redline = await within(text).findByRole('list', { name: 'Changes from 0.2 to 0.3' });
    expect(redline.querySelector('ins')?.textContent).toMatch(/^Added: .*carefully/);
    await userEvent.click(within(text).getByRole('button', { name: 'Hide the comparison' }));
    expect(within(text).queryByRole('list', { name: 'Changes from 0.2 to 0.3' })).toBeNull();
  });

  it('CNT-181 closes a comparison shown when a still newer version is named, rather than show the older one under it', async () => {
    const { text, latest } = await openPinned({ newer: true });
    await userEvent.click(within(text).getByRole('button', { name: 'Compare 0.2 with 0.3' }));
    await within(text).findByRole('list', { name: 'Changes from 0.2 to 0.3' });
    latest.id = 'bbbbbbbb-0000-4000-8000-000000000004';
    latest.number = '0.4';
    // The page reads its texts again when the window is focused.
    window.dispatchEvent(new Event('focus'));
    expect(
      await within(text).findByText('Version 0.4 is newer than the 0.2 pinned here.'),
    ).toBeVisible();
    expect(within(text).queryByRole('list', { name: /^Changes from / })).toBeNull();
    expect(within(text).getByRole('button', { name: 'Compare 0.2 with 0.4' })).toBeVisible();
  });

  it('alerts that a comparison could not be read, and offers it again', async () => {
    const { text } = await openPinned({ newer: true, failing: true });
    await userEvent.click(within(text).getByRole('button', { name: 'Compare 0.2 with 0.3' }));
    expect(await within(text).findByRole('alert')).toHaveTextContent(
      'The comparison could not be read.',
    );
    expect(within(text).getByRole('button', { name: 'Compare 0.2 with 0.3' })).toBeVisible();
  });

  it('says nothing where no newer version is named', async () => {
    const { text } = await openPinned({ newer: false });
    expect(within(text).queryByText(/is newer than/)).toBeNull();
    expect(within(text).queryByRole('button', { name: /^Compare / })).toBeNull();
  });
});
