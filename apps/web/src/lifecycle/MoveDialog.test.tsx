import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, type RefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MoveDialog } from './MoveDialog.js';

const SPACES = {
  items: [
    { id: 's1', name: 'General', mayMoveInto: true },
    { id: 's2', name: 'Quality', mayMoveInto: true },
    { id: 's3', name: 'Closed', mayMoveInto: false },
  ],
  next: null,
};

const PREVIEW = {
  changed: true,
  moved: ['d1', 'c1'],
  skipped: [{ id: 'c2', kind: 'component', reason: 'placed_elsewhere', title: 'Shared part' }],
  grantsEnded: 1,
  sharesKept: 0,
  consequences: {
    citations: 2,
    terms: 0,
    imagesStaying: 0,
    bound: 0,
    usingTemplate: 0,
    openRounds: 0,
    delivered: 0,
  },
};

let previewed: unknown = PREVIEW;

function service(moved: { status: number; answer: unknown }) {
  const sent: { path: string; body: unknown }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(request.url).pathname;
    const reply = (status: number, answer: unknown) =>
      new Response(JSON.stringify(answer), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (path === '/v1/spaces') return reply(200, SPACES);
    sent.push({ path, body: await request.clone().json() });
    if (path.endsWith('/preview')) return reply(200, previewed);
    return reply(moved.status, moved.answer);
  }) as typeof globalThis.fetch;
  return { client: createApiClient({ baseUrl: 'http://acme.example.test', fetch }), sent };
}

function opened(client: ReturnType<typeof createApiClient>, carries = true) {
  const act: RefObject<(() => void) | null> = createRef();
  const onChanged = vi.fn();
  render(
    <MoveDialog
      act={act}
      client={client}
      id="d1"
      from="s1"
      carries={carries}
      onChanged={onChanged}
    />,
  );
  return { act, onChanged };
}

const open = async (act: RefObject<(() => void) | null>) => {
  await waitFor(() => expect(act.current).not.toBeNull());
  act.current!();
  return screen.findByRole('dialog', { name: 'Move to another space' });
};

describe('moving to another space', () => {
  it('offers only where the caller may move, and says first what comes along and what stays', async () => {
    const { client, sent } = service({ status: 200, answer: PREVIEW });
    const { act } = opened(client);
    const dialog = await open(act);

    const where = await screen.findByRole('combobox', { name: 'Move to' });
    expect([...(where as HTMLSelectElement).options].map((each) => each.text)).toEqual(['Quality']);
    await waitFor(() => expect(dialog).toHaveTextContent('This moves 2 items.'));
    expect(dialog).toHaveTextContent('Shared part stays: another document places it.');
    expect(dialog).toHaveTextContent('1 direct grant on it ends.');
    expect(dialog).toHaveTextContent('2 citations');
    expect(dialog).not.toHaveTextContent('review round');
    expect(sent[0]).toEqual({
      path: '/v1/artifacts/d1/move/preview',
      body: { from: 's1', to: 's2', also: true },
    });
  });

  it('moves as previewed, and says where it went and how much stayed', async () => {
    const { client, sent } = service({ status: 200, answer: PREVIEW });
    const { act, onChanged } = opened(client);
    await open(act);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Move' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Move' }));

    await waitFor(() =>
      expect(onChanged).toHaveBeenCalledWith('Moved 2 items to Quality. 1 stayed where it was.'),
    );
    expect(sent.at(-1)).toEqual({
      path: '/v1/artifacts/d1/move',
      body: { from: 's1', to: 's2', also: true },
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks again without what it would carry, and a component is not offered that', async () => {
    const { client, sent } = service({ status: 200, answer: PREVIEW });
    const { act } = opened(client);
    await open(act);
    await userEvent.click(await screen.findByRole('checkbox', { name: /Also move/ }));
    await waitFor(() =>
      expect(sent.at(-1)).toEqual({
        path: '/v1/artifacts/d1/move/preview',
        body: { from: 's1', to: 's2', also: false },
      }),
    );
  });

  it('a component is moved alone', async () => {
    const { client } = service({ status: 200, answer: PREVIEW });
    const { act } = opened(client, false);
    await open(act);
    await screen.findByRole('combobox', { name: 'Move to' });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('hands back to the page where it has moved since, and lists alike parts without a clash', async () => {
    const { client } = service({
      status: 409,
      answer: { code: 'space_moved', message: 'x', traceId: 't' },
    });
    previewed = {
      ...PREVIEW,
      skipped: [
        { id: 'c2', kind: 'component', reason: 'not_permitted', title: null },
        { id: 'c3', kind: 'component', reason: 'not_permitted', title: null },
      ],
    };
    const { act, onChanged } = opened(client);
    const dialog = await open(act);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Move' })).toBeEnabled());
    expect(dialog.querySelectorAll('li')).toHaveLength(4);
    await userEvent.click(screen.getByRole('button', { name: 'Move' }));
    await waitFor(() =>
      expect(onChanged).toHaveBeenCalledWith(
        'It had already moved to another space. This page now shows where it is.',
      ),
    );
    previewed = PREVIEW;
  });

  it('says why it was refused, and stays open', async () => {
    const { client } = service({
      status: 409,
      answer: { code: 'artifact_held', message: 'x', traceId: 't' },
    });
    const { act, onChanged } = opened(client);
    const dialog = await open(act);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Move' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(dialog).toHaveTextContent('A hold stops this moving.'));
    expect(onChanged).not.toHaveBeenCalled();
  });
});
