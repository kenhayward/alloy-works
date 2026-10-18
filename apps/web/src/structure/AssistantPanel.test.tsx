import { createApiClient, type StreamPostOptions } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AssistantPanel } from './AssistantPanel.js';

const DOCUMENT = '0b6f6b8e-4a39-4c1e-9d0f-3c0a8f1e2d41';
const SITES = '6a1d9c2e-7b3f-4e8a-9c5d-1f2e3a4b5c6d';
const PROPOSAL = '2c4e6a8b-1d3f-4a5b-8c7d-9e0f1a2b3c4d';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The proposal acts and the month's usage, as the service answers them. */
function service() {
  const asked: string[] = [];
  const fetching = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(request.url).pathname;
    asked.push(`${request.method} ${path}`);
    if (path === '/v1/me/assistant-usage') {
      return json(200, { runs: 3, costs: [{ currency: 'USD', cost: '0.001800' }] });
    }
    if (path === `/v1/assistant/proposals/${PROPOSAL}/acceptance`) {
      return json(200, { proposal: { id: PROPOSAL, state: 'accepted', suggestion: 'x' } });
    }
    if (path === `/v1/assistant/proposals/${PROPOSAL}/discarding`) {
      return json(200, { proposal: { id: PROPOSAL, state: 'discarded', suggestion: null } });
    }
    return json(404, { code: 'not_found', message: 'There is nothing at this address.' });
  }) as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://doc.test', fetch: fetching }), asked };
}

/** A run streamed as the service would: its frames, in order. */
const running = (frames: [string, unknown][]) => async (options: StreamPostOptions) => {
  for (const [event, data] of frames) options.onEvent(event, data);
  return { kind: 'streamed' as const };
};

const ended = (over: Record<string, unknown> = {}) =>
  [
    'ended',
    {
      outcome: 'finished',
      model: 'stand-in-1',
      tokensIn: 100,
      tokensOut: 20,
      cost: '0.000600',
      currency: 'USD',
      citations: [],
      dropped: [],
      ...over,
    },
  ] as [string, unknown];

describe("the document page's Assistant (the G2 plan, G2-K)", () => {
  it('GEN-010 GEN-037 shows the answer, what it did and what came back, and what it cost, saying the endpoint sits outside the boundary', async () => {
    const user = userEvent.setup();
    const { client } = service();
    const stream = vi.fn(
      running([
        ['run', { run: 'r1', endpoint: { name: 'Drafting', boundary: 'outside' } }],
        ['tool_call', { id: 't1', name: 'read_outline', input: {} }],
        [
          'tool_result',
          {
            id: 't1',
            name: 'read_outline',
            ok: true,
            summary: '2 components',
            result: '<content>Sites</content>',
          },
        ],
        ['text', { text: 'It has two ' }],
        ['text', { text: 'parts.' }],
        ended(),
      ]),
    );
    render(
      <AssistantPanel
        client={client}
        document={DOCUMENT}
        component={SITES}
        onCite={() => {}}
        stream={stream}
        origin="http://doc.test"
      />,
    );
    await user.type(screen.getByLabelText('Ask the assistant'), 'What is here?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(stream.mock.calls[0]![0]).toMatchObject({
      url: `http://doc.test/v1/documents/${DOCUMENT}/assistant/runs`,
      body: { ask: 'What is here?', component: SITES },
    });
    expect(await screen.findByText('It has two parts.')).toBeVisible();
    expect(screen.getByText('Using Drafting, which is outside your data boundary.')).toBeVisible();
    await user.click(screen.getByText('What it did (1 step)'));
    expect(screen.getByText('Read the outline')).toBeVisible();
    expect(screen.getByText('<content>Sites</content>')).toBeVisible();
    await waitFor(() =>
      expect(
        screen.getByText(
          /100 tokens in, 20 out: USD 0.000600\. This month: 3 runs, USD 0.001800\./,
        ),
      ).toBeVisible(),
    );
  });

  it('GEN-011 links each citation it kept to the part it names, and says when one was left out', async () => {
    const user = userEvent.setup();
    const { client } = service();
    const onCite = vi.fn();
    const stream = running([
      ['run', { run: 'r1', endpoint: { name: 'Drafting', boundary: 'inside' } }],
      ['text', { text: `It floods [[${SITES}#p1]] each spring [[${DOCUMENT}#p9]].` }],
      ended({
        citations: [{ component: SITES, block: 'p1' }],
        dropped: [{ component: DOCUMENT, block: 'p9' }],
      }),
    ]);
    render(
      <AssistantPanel
        client={client}
        document={DOCUMENT}
        component={null}
        nameOf={(id) => (id === SITES ? 'Sites' : undefined)}
        onCite={onCite}
        stream={stream}
        origin="http://doc.test"
      />,
    );
    await user.type(screen.getByLabelText('Ask the assistant'), 'When does it flood?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText('It floods [1] each spring .')).toBeVisible();
    await user.click(
      within(screen.getByRole('list', { name: 'Sources' })).getByRole('button', {
        name: 'Sites, block p1',
      }),
    );
    expect(onCite).toHaveBeenCalledWith(SITES, 'p1');
    expect(
      screen.getByText('One citation was left out: it named text the assistant did not read.'),
    ).toBeVisible();
  });

  it('GEN-009 shows a proposal that changes nothing until it is accepted, kept or discarded', async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    const stream = running([
      ['run', { run: 'r1', endpoint: { name: 'Drafting', boundary: 'inside' } }],
      [
        'proposal',
        {
          id: PROPOSAL,
          number: 1,
          component: SITES,
          against: 'v1',
          proposed: {
            content: [
              {
                type: 'paragraph',
                id: 'p1',
                content: [{ type: 'text', value: 'It floods every spring.' }],
              },
            ],
          },
        },
      ],
      ended(),
    ]);
    render(
      <AssistantPanel
        client={client}
        document={DOCUMENT}
        component={SITES}
        nameOf={() => 'Sites'}
        onCite={() => {}}
        stream={stream}
        origin="http://doc.test"
      />,
    );
    await user.type(screen.getByLabelText('Ask the assistant'), 'Tighten it.');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    const proposal = await screen.findByRole('article', { name: 'Proposal 1' });
    expect(within(proposal).getByText('It floods every spring.')).toBeVisible();
    expect(asked.some((each) => each.includes('/proposals/'))).toBe(false);
    await user.click(within(proposal).getByRole('button', { name: 'Accept' }));
    expect(
      await within(proposal).findByText('Accepted: it is a new version of the part.'),
    ).toBeVisible();
    expect(asked).toContain(`POST /v1/assistant/proposals/${PROPOSAL}/acceptance`);
    expect(within(proposal).queryByRole('button', { name: 'Discard' })).toBeNull();
  });

  it('says why it was not asked, in the service’s words', async () => {
    const user = userEvent.setup();
    const { client } = service();
    const refused = async () => ({
      kind: 'refused' as const,
      status: 409,
      body: { code: 'model_unconfigured', message: 'No model endpoint is set up for drafting.' },
    });
    render(
      <AssistantPanel
        client={client}
        document={DOCUMENT}
        component={null}
        onCite={() => {}}
        stream={refused}
        origin="http://doc.test"
      />,
    );
    await user.type(screen.getByLabelText('Ask the assistant'), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText('No model endpoint is set up for drafting.')).toBeVisible();
  });
});
