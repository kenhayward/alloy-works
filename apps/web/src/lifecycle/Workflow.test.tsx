import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { TransitionButtons, type Standing } from './Workflow.js';

const ID = '5d9c6b1e-2f3a-4b5c-8d7e-9f0a1b2c3d4e';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const IN_REVIEW: Standing = {
  state: { key: 'in_review', name: 'In review', approved: false },
  transitions: [
    { key: 'return', name: 'Return', to: { key: 'draft', name: 'Draft' }, reasonRequired: true },
    {
      key: 'approve',
      name: 'Approve',
      to: { key: 'approved', name: 'Approved' },
      reasonRequired: false,
    },
  ],
};

/** The move route, answering as `answer` says, remembering each body sent. */
function service(answer: (body: unknown) => Response) {
  const sent: unknown[] = [];
  const fetching = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const body = (await request.json()) as unknown;
    sent.push({ path: new URL(request.url).pathname, body });
    return answer(body);
  }) as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://dev.acme.test', fetch: fetching }), sent };
}

function place(client: ReturnType<typeof createApiClient>, standing = IN_REVIEW) {
  const said: string[] = [];
  const moved: Standing[] = [];
  let stale = 0;
  render(
    <TransitionButtons
      client={client}
      kind="document"
      id={ID}
      title="Dosing guide"
      standing={standing}
      onMoved={(now, words) => {
        moved.push(now);
        said.push(words);
      }}
      onNotice={(words) => said.push(words)}
      onStale={() => (stale += 1)}
    />,
  );
  return { said, moved, stale: () => stale };
}

describe('moving along a workflow transition (the WF1 plan, WF-F)', () => {
  it('offers only the transitions the view says the reader may take, and moves from the state it saw', async () => {
    const { client, sent } = service(() =>
      json(200, { state: { key: 'approved', name: 'Approved', approved: true }, transitions: [] }),
    );
    const { said, moved } = place(client);
    expect(screen.getAllByRole('button').map((each) => each.textContent)).toEqual([
      'Return',
      'Approve',
    ]);

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(said).toEqual(['Moved Dosing guide to Approved.']));
    expect(sent).toEqual([
      {
        path: `/v1/documents/${ID}/transitions`,
        body: { transition: 'approve', from: 'in_review' },
      },
    ]);
    expect(moved).toEqual([
      { state: { key: 'approved', name: 'Approved', approved: true }, transitions: [] },
    ]);
  });

  it('LIF-061 asks for a reason where the transition requires one, and sends it', async () => {
    const { client, sent } = service(() =>
      json(200, { state: { key: 'draft', name: 'Draft', approved: false }, transitions: [] }),
    );
    const { said } = place(client);

    await userEvent.click(screen.getByRole('button', { name: 'Return' }));
    const dialog = screen.getByRole('dialog', { name: 'Return Dosing guide' });
    expect(dialog).toHaveTextContent('It moves to Draft.');
    await userEvent.click(screen.getByRole('button', { name: 'Return to Draft' }));
    expect(await screen.findByText('Give a reason.')).toBeInTheDocument();
    expect(sent).toEqual([]);

    await userEvent.type(screen.getByLabelText('Reason'), 'Name the dose.');
    await userEvent.click(screen.getByRole('button', { name: 'Return to Draft' }));
    await waitFor(() => expect(said).toEqual(['Moved Dosing guide to Draft.']));
    expect(sent).toEqual([
      {
        path: `/v1/documents/${ID}/transitions`,
        body: { transition: 'return', from: 'in_review', reason: 'Name the dose.' },
      },
    ]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says a refusal by name, and reads the state again where it moved meanwhile', async () => {
    const { client } = service(() =>
      json(409, {
        code: 'state_moved',
        message: 'It has moved to Approved since.',
        traceId: 't',
        state: { key: 'approved', name: 'Approved' },
      }),
    );
    const { said, moved, stale } = place(client);

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(stale()).toBe(1));
    expect(said).toEqual(['Dosing guide was not moved. It has moved to Approved since.']);
    expect(moved).toEqual([]);
  });

  it('offers nothing where the reader may take no transition', () => {
    const { client } = service(() => json(500, {}));
    place(client, { state: { key: 'draft', name: 'Draft', approved: false }, transitions: [] });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
