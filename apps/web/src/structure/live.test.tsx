import { createApiClient, type FollowOptions } from '@alloy-works/api-client';
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { freshnessOf, useLiveDocument, type LiveDocument } from './live.js';
import { PeopleHere } from './PeopleHere.js';

const ADA = 'a0000000-0000-4000-8000-000000000001';
const GRACE = 'a0000000-0000-4000-8000-000000000002';
const DOCUMENT = 'd0000000-0000-4000-8000-000000000001';
const DOSING = 'c0000000-0000-4000-8000-000000000001';
const AT = Date.parse('2026-10-11T12:00:00.000Z');

/** A stream the test speaks for: what was asked of it, and a way to say each event. */
function fakeStream() {
  const opened: FollowOptions[] = [];
  const follow = (options: FollowOptions) => {
    opened.push(options);
    return () => undefined;
  };
  return {
    follow,
    opened,
    say: (event: string, data: unknown) => act(() => opened.at(-1)!.onEvent!(event, data)),
    drop: () => act(() => opened.at(-1)!.onDropped!()),
  };
}

function service() {
  const asked: { method: string; path: string; body: unknown }[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const text = await request.text();
    asked.push({
      method: request.method,
      path: new URL(request.url).pathname,
      body: text === '' ? null : JSON.parse(text),
    });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://live.test', fetch: fetching }), asked };
}

const grace = (beatAt: string, component: string | null = DOSING, mode = 'author') => ({
  viewer: 'v0000000-0000-4000-8000-000000000002',
  person: { id: GRACE, name: 'Grace Hopper' },
  component,
  mode,
  beatAt,
});

function Harness(props: {
  follow: (options: FollowOptions) => () => void;
  client: ReturnType<typeof createApiClient>;
  now?: () => number;
  seen: (live: LiveDocument) => void;
}) {
  const live = useLiveDocument({
    client: props.client,
    document: DOCUMENT,
    principalId: ADA,
    component: DOSING,
    mode: 'author',
    follow: props.follow,
    now: props.now ?? (() => AT),
  });
  props.seen(live);
  return <PeopleHere people={live.people} connected={live.connected} />;
}

describe('a document as it happens, on the page', () => {
  it('COL-001 COL-002 shows who else is in the document and what they are doing, never the reader themselves', async () => {
    const stream = fakeStream();
    const { client } = service();
    render(<Harness follow={stream.follow} client={client} seen={() => undefined} />);
    expect(stream.opened[0]!.url).toMatch(new RegExp(`/v1/stream\\?document=${DOCUMENT}&viewer=`));
    stream.say('snapshot', {
      locks: [],
      presence: [
        grace(new Date(AT - 5_000).toISOString()),
        { ...grace(new Date(AT).toISOString()), viewer: 'own', person: { id: ADA, name: 'Ada' } },
      ],
    });
    const people = await screen.findByRole('list', { name: 'Also here' });
    expect(people).toHaveTextContent('Grace Hopper, editing');
    expect(people).not.toHaveTextContent('Ada');
  });

  it('COL-055 fades somebody not heard from in 30 seconds, and drops them after a minute', async () => {
    const stream = fakeStream();
    const { client } = service();
    let now = AT;
    render(
      <Harness follow={stream.follow} client={client} now={() => now} seen={() => undefined} />,
    );
    stream.say('snapshot', { locks: [], presence: [grace(new Date(AT).toISOString())] });
    expect(await screen.findByText('Grace Hopper, editing')).toBeInTheDocument();
    now = AT + 40_000;
    stream.say('lock', { component: DOSING, holder: null, expectedRelease: null });
    expect(
      await screen.findByText('Grace Hopper, editing, not heard from lately'),
    ).toBeInTheDocument();
    now = AT + 70_000;
    stream.say('lock', { component: DOSING, holder: null, expectedRelease: null });
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Also here' })).toBeNull());
    expect(freshnessOf(AT, AT + 29_999)).toBe('live');
    expect(freshnessOf(AT, AT + 30_000)).toBe('stale');
  });

  it('COL-004 shows nobody, and says it does not know, once the stream drops', async () => {
    const stream = fakeStream();
    const { client } = service();
    render(<Harness follow={stream.follow} client={client} seen={() => undefined} />);
    stream.say('snapshot', { locks: [], presence: [grace(new Date(AT).toISOString())] });
    await screen.findByText('Grace Hopper, editing');
    stream.drop();
    expect(await screen.findByText('Who is here is not known just now')).toBeInTheDocument();
    expect(screen.queryByText(/Grace Hopper/)).toBeNull();
  });

  it('API-035 takes the snapshot on reconnecting as the whole picture, so a release missed while away leaves no lock held', async () => {
    const stream = fakeStream();
    const { client } = service();
    let live: LiveDocument | undefined;
    render(<Harness follow={stream.follow} client={client} seen={(each) => (live = each)} />);
    stream.say('snapshot', {
      locks: [
        {
          component: DOSING,
          holder: { id: GRACE, name: 'Grace Hopper' },
          expectedRelease: '2026-10-11T12:15:00.000Z',
        },
      ],
      presence: [grace(new Date(AT).toISOString())],
    });
    expect(live!.locks.get(DOSING)?.holder?.id).toBe(GRACE);
    // Away while Grace released it and left: neither event reaches this window.
    stream.drop();
    expect(live!.connected).toBe(false);
    // Back: the snapshot holds no lock and nobody, and that is what the window now holds.
    stream.say('snapshot', { locks: [], presence: [] });
    expect(live!.connected).toBe(true);
    expect(live!.locks.get(DOSING)).toBeUndefined();
    expect(live!.people).toEqual([]);
  });

  it("COL-007 holds each component's lock as the stream says it, claimed and released", async () => {
    const stream = fakeStream();
    const { client } = service();
    let live: LiveDocument | undefined;
    render(<Harness follow={stream.follow} client={client} seen={(each) => (live = each)} />);
    stream.say('snapshot', { locks: [], presence: [] });
    const held = {
      component: DOSING,
      holder: { id: GRACE, name: 'Grace Hopper' },
      expectedRelease: '2026-10-11T12:15:00.000Z',
    };
    stream.say('lock', held);
    expect(live!.locks.get(DOSING)).toEqual(held);
    stream.say('lock', { component: DOSING, holder: null, expectedRelease: null });
    expect(live!.locks.get(DOSING)?.holder).toBeNull();
  });

  it("beats this window's presence, where it is and what it is doing, and says when it leaves", async () => {
    const stream = fakeStream();
    const { client, asked } = service();
    const { unmount } = render(
      <Harness follow={stream.follow} client={client} seen={() => undefined} />,
    );
    await waitFor(() => expect(asked.some((each) => each.method === 'PUT')).toBe(true));
    const beat = asked.find((each) => each.method === 'PUT')!;
    expect(beat.path).toBe('/v1/presence');
    expect(beat.body).toMatchObject({ document: DOCUMENT, component: DOSING, mode: 'author' });
    unmount();
    await waitFor(() =>
      expect(
        asked.some((each) => each.method === 'DELETE' && each.path.startsWith('/v1/presence/')),
      ).toBe(true),
    );
  });
});
