import { createApiClient } from '@alloy-works/api-client';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ThreadsPanel, type ReviewTarget } from './ThreadsPanel.js';

const DOCUMENT = 'dddddddd-0000-4000-8000-000000000001';
const COMPONENT = 'cccccccc-0000-4000-8000-000000000001';
const VERSION = 'cccccccc-0000-4000-8000-000000000002';
const ADA = 'aaaaaaaa-0000-4000-8000-000000000001';
const GRACE = 'aaaaaaaa-0000-4000-8000-000000000002';
const IVY = 'aaaaaaaa-0000-4000-8000-000000000003';
const OUTSIDER = 'aaaaaaaa-0000-4000-8000-000000000004';
const id = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PEOPLE = [
  { id: ADA, name: 'Ada' },
  { id: GRACE, name: 'Grace' },
  { id: IVY, name: 'Ivy' },
];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Part = { text: string } | { mention: string };
interface Held {
  id: string;
  anchor: Record<string, unknown>;
  on: { id: string; kind: 'component' | 'document' };
  internal: boolean;
  resolution: { by: { id: string; name: string }; at: string } | null;
  new?: boolean;
  comments: {
    id: string;
    author: { id: string; name: string };
    at: string;
    drafted?: { model: string | null };
    texts: { parts: Part[]; at: string }[];
  }[];
}

/** The thread routes, answered from threads the test holds, Ada calling. */
function service() {
  const threads: Held[] = [];
  const asked: string[] = [];
  const view = (thread: Held, untold: string[] = []) => ({
    ...thread,
    madeAgainst: VERSION,
    startedBy: thread.comments[0]!.author,
    startedAt: thread.comments[0]!.at,
    untold,
  });
  const summary = (thread: Held) => ({
    id: thread.id,
    on: thread.on,
    anchor: thread.anchor,
    madeAgainst: VERSION,
    startedBy: thread.comments[0]!.author,
    startedAt: thread.comments[0]!.at,
    resolvedAt: thread.resolution?.at ?? null,
    internal: thread.internal,
    comments: thread.comments.length,
    lastAt: thread.comments[0]!.at,
    said: thread.comments[0]!.texts.at(-1)!.parts,
    participants: [
      ...new Map(thread.comments.map((each) => [each.author.id, each.author])).values(),
    ],
    mentioned: thread.comments.flatMap((each) =>
      each.texts.at(-1)!.parts.flatMap((part) => ('mention' in part ? [part.mention] : [])),
    ),
    words: thread.comments
      .map((each) =>
        each.texts
          .at(-1)!
          .parts.flatMap((part) => ('text' in part ? [part.text] : []))
          .join(''),
      )
      .join('\n'),
    drafted: thread.comments.some((each) => each.drafted !== undefined),
    new: thread.new === true,
    orphaned: false,
    places: [{ node: 'n1', orphaned: false }],
  });
  const comment = (parts: Part[]) => ({
    id: id(100 + threads.flatMap((each) => each.comments).length),
    author: { id: ADA, name: 'Ada' },
    at: '2026-10-12T10:00:00.000Z',
    texts: [{ parts, at: '2026-10-12T10:00:00.000Z' }],
  });
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    asked.push(`${request.method} ${url.pathname}${url.search}`);
    if (url.pathname === '/v1/threads/read') return new Response(null, { status: 204 });
    const thread = threads.find((each) => url.pathname.includes(each.id));
    if (request.method === 'GET' && url.pathname.endsWith('/threads')) {
      const state = url.searchParams.get('state');
      const shown = threads
        .filter((each) =>
          state === null ? true : state === 'open' ? !each.resolution : !!each.resolution,
        )
        .map(summary);
      // A page of one, so the panel must follow `next` to list them all.
      const at = Number(url.searchParams.get('cursor') ?? '0');
      return json(200, {
        threads: shown.slice(at, at + 1),
        next: at + 1 < shown.length ? String(at + 1) : null,
      });
    }
    if (request.method === 'GET') return json(200, view(thread!));
    const body = (await request.json().catch(() => ({}))) as {
      parts: Part[];
      anchor: Record<string, unknown>;
      internal?: boolean;
    };
    if (url.pathname.endsWith('/internal')) {
      thread!.internal = true;
      return json(200, view(thread!));
    }
    if (url.pathname.endsWith('/threads')) {
      const made: Held = {
        id: id(threads.length + 1),
        anchor: body.anchor,
        on: { id: COMPONENT, kind: 'component' },
        internal: body.internal === true,
        resolution: null,
        comments: [comment(body.parts)],
      };
      threads.push(made);
      const named = body.parts.flatMap((part) => ('mention' in part ? [part.mention] : []));
      return json(
        200,
        view(
          made,
          named.filter((each) => each === IVY),
        ),
      );
    }
    if (url.pathname.endsWith('/resolution')) {
      thread!.resolution = { by: { id: ADA, name: 'Ada' }, at: '2026-10-12T11:00:00.000Z' };
      return json(200, view(thread!));
    }
    if (request.method === 'PUT') {
      const edited = thread!.comments.find((each) => url.pathname.endsWith(each.id))!;
      edited.texts.push({ parts: body.parts, at: '2026-10-12T10:30:00.000Z' });
      return json(200, view(thread!));
    }
    thread!.comments.push({ ...comment(body.parts), author: { id: GRACE, name: 'Grace' } });
    return json(200, view(thread!));
  }) as unknown as typeof fetch;
  return {
    client: createApiClient({ baseUrl: 'http://acme.test', fetch: fetching }),
    asked,
    threads,
  };
}

const TARGETS: ReviewTarget[] = [
  {
    key: 'selection',
    label: 'The selected text “the tray”',
    on: { kind: 'component', id: COMPONENT },
    version: VERSION,
    anchor: { kind: 'span', block: 'p1', quote: 'the tray', before: 'Set ' },
  },
  {
    key: 'whole',
    label: 'The whole of Install the printer',
    on: { kind: 'component', id: COMPONENT },
    version: VERSION,
    anchor: { kind: 'component' },
  },
];

const panel = (client: ReturnType<typeof service>['client'], as = ADA) =>
  render(
    <ThreadsPanel
      client={client}
      document={DOCUMENT}
      targets={TARGETS}
      people={[...PEOPLE, { id: OUTSIDER, name: 'Alice', external: true }]}
      principalId={as}
      mayAnswer={() => true}
      placeOf={() => '1 Method'}
    />,
  );

/** A thread held by the service, by Grace unless said. */
const held = (n: number, words: string, over: Partial<Held> = {}): Held => ({
  id: id(n),
  anchor: { kind: 'component' },
  on: { id: COMPONENT, kind: 'component' },
  internal: false,
  resolution: null,
  comments: [
    {
      id: id(200 + n),
      author: { id: GRACE, name: 'Grace' },
      at: '2026-10-12T10:00:00.000Z',
      texts: [{ parts: [{ text: words }], at: '2026-10-12T10:00:00.000Z' }],
    },
  ],
  ...over,
});

const startOn = async (words: string, on?: string) => {
  if (screen.queryByLabelText('Comment') === null) {
    await userEvent.click(screen.getByRole('button', { name: 'New thread' }));
  }
  if (on !== undefined) await userEvent.selectOptions(screen.getByLabelText('On'), on);
  await userEvent.type(screen.getByLabelText('Comment'), words);
  await userEvent.click(screen.getByRole('button', { name: 'Start thread' }));
};

const showing = async (choice: RegExp) => {
  await userEvent.click(screen.getByRole('button', { name: /^Show: / }));
  await userEvent.click(screen.getByRole('menuitemradio', { name: choice }));
};

describe('the threads panel', () => {
  it('reads its threads again when told to, for an act that was not its own', async () => {
    const { client, asked } = service();
    const props = {
      client,
      document: DOCUMENT,
      targets: [],
      people: PEOPLE,
      principalId: ADA,
      mayAnswer: () => true,
      placeOf: () => '1 Method',
    };
    const shown = render(<ThreadsPanel {...props} readAgain={0} />);
    await screen.findByText('No threads here.');
    const listed = () =>
      asked.filter((each) => each.startsWith(`GET /v1/documents/${DOCUMENT}/threads`)).length;
    expect(listed()).toBe(1);
    shown.rerender(<ThreadsPanel {...props} readAgain={1} />);
    await waitFor(() => expect(listed()).toBe(2));
  });

  it('CNT-157 COL-015 starts a thread on the selected text, naming people where they were typed, and says who could not be told', async () => {
    const { client, asked, threads } = service();
    panel(client);
    expect(await screen.findByText('No threads here.')).toBeInTheDocument();
    const words = screen.getByLabelText('Comment');
    await userEvent.type(words, 'Is this right, @gr');
    const offered = screen.getByRole('listbox', { name: 'Mention someone' });
    expect(within(offered).getByRole('option', { name: 'Grace' })).toBeInTheDocument();
    await userEvent.type(words, '{Enter}and @iv{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Start thread' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Not told, as they may not read this: Ivy.',
    );
    expect(asked).toContain(`POST /v1/components/${COMPONENT}/threads`);
    expect(threads[0]!.anchor).toEqual(TARGETS[0]!.anchor);
    expect(threads[0]!.comments[0]!.texts[0]!.parts).toEqual([
      { text: 'Is this right, ' },
      { mention: GRACE },
      { text: ' and ' },
      { mention: IVY },
      { text: ' ' },
    ]);
    // Opened at once, its comment shown with the people it names.
    const opened = screen.getByRole('heading', { name: '“the tray”' }).closest('section')!;
    expect(within(opened).getByText('@Grace')).toBeInTheDocument();
  });

  it('CNT-137 announces a thread started and resolved, naming which and where, in a status region there from the start', async () => {
    const { client } = service();
    panel(client);
    await screen.findByText('No threads here.');
    // Present and empty before anything happens, so the first announcement is heard.
    expect(screen.getByRole('status')).toHaveTextContent('');
    await startOn('Is this right?');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Thread started on “the tray” in 1 Method.',
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Thread on “the tray” in 1 Method resolved.',
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'All threads' }));
    await startOn('And this', 'whole');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Thread started on the whole component in 1 Method.',
      ),
    );
  });

  it('CNT-157 answers a thread, edits one’s own comment keeping its earlier text, and resolves it', async () => {
    const { client } = service();
    panel(client);
    await screen.findByText('No threads here.');
    await startOn('First', 'whole');
    await screen.findByRole('heading', { name: 'The whole component' });

    await userEvent.type(screen.getByRole('combobox', { name: 'Reply' }), 'Yes');
    await userEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(await screen.findByText('Yes')).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);
    const mine = screen.getByLabelText('Your comment');
    await userEvent.clear(mine);
    await userEvent.type(mine, 'First, amended');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('First, amended')).toBeInTheDocument();
    expect(screen.getByText(/\(edited\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByText('Earlier texts'));
    expect(screen.getByText('First')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(await screen.findByText(/Resolved by Ada/)).toBeInTheDocument();
    // A resolved thread takes nothing more.
    expect(screen.queryByRole('combobox', { name: 'Reply' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();

    // A second thread: the list, paged by the service, holds both.
    await userEvent.click(screen.getByRole('button', { name: 'All threads' }));
    await startOn('Second', 'selection');
    await screen.findByRole('heading', { name: '“the tray”' });
    await userEvent.click(screen.getByRole('button', { name: 'All threads' }));
    await showing(/^All threads/);
    expect(await screen.findByRole('button', { name: /“the tray”/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /The whole component/ })).toBeInTheDocument();
    await showing(/^Open/);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /The whole component/ })).toBeNull(),
    );
    expect(screen.getByRole('button', { name: /“the tray”/ })).toBeInTheDocument();
    await showing(/^Resolved/);
    const listed = await screen.findByRole('button', { name: /The whole component/ });
    expect(within(listed.closest('li')!).getByText('Resolved')).toBeInTheDocument();
  });

  it('COL-067 lists a thread on a component since deleted as no longer there, never new, and says why it does not open', async () => {
    const orphan = id(9);
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      if (url.pathname.endsWith('/threads')) {
        return json(200, {
          threads: [
            {
              id: orphan,
              on: { id: COMPONENT, kind: 'component' },
              anchor: { kind: 'component' },
              madeAgainst: VERSION,
              startedBy: { id: ADA, name: 'Ada' },
              startedAt: '2026-10-12T10:00:00.000Z',
              resolvedAt: null,
              comments: 1,
              lastAt: '2026-10-12T10:00:00.000Z',
              said: [{ text: 'Gone' }],
              participants: [{ id: ADA, name: 'Ada' }],
              mentioned: [],
              words: 'Gone',
              drafted: false,
              new: false,
              orphaned: true,
              places: [],
            },
          ],
          next: null,
        });
      }
      return json(410, { code: 'artifact_deleted', message: 'This has been deleted.' });
    }) as unknown as typeof fetch;
    panel(createApiClient({ baseUrl: 'http://acme.test', fetch: fetching }));
    const card = await screen.findByRole('button', { name: /The whole component/ });
    expect(
      within(card.closest('li')!).getByText('Its text is no longer there'),
    ).toBeInTheDocument();
    await userEvent.click(card);
    expect(await screen.findByRole('alert')).toHaveTextContent('This has been deleted.');
  });

  it('COL-038 starts a thread internal, says so, and makes an open one internal once, offering neither to somebody from outside', async () => {
    const { client, threads } = service();
    const { unmount } = panel(client);
    await screen.findByText('No threads here.');
    await userEvent.type(screen.getByLabelText('Comment'), 'Between us.');
    await userEvent.click(
      screen.getByRole('checkbox', {
        name: 'Internal: nobody from outside the organisation sees it',
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Start thread' }));
    await waitFor(() => expect(threads[0]?.internal).toBe(true));
    const opened = screen.getByRole('heading', { name: '“the tray”' }).closest('section')!;
    expect(within(opened).getAllByText('Internal').length).toBeGreaterThan(0);
    expect(within(opened).queryByRole('button', { name: 'Make internal' })).toBeNull();
    // Once internal it stays so: the padlock pressed and at rest.
    const padlock = within(opened).getByRole('button', { name: 'Internal' });
    expect(padlock).toHaveAttribute('aria-pressed', 'true');
    expect(padlock).toBeDisabled();

    // A thread started public is made internal from where it is read, once.
    await userEvent.click(within(opened).getByRole('button', { name: 'All threads' }));
    await startOn('For everybody.');
    const second = await screen.findByRole('button', { name: 'Make internal' });
    await userEvent.click(second);
    await waitFor(() => expect(threads[1]?.internal).toBe(true));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Nobody from outside the organisation sees it now.',
    );
    unmount();

    // Somebody from outside is offered neither.
    const outside = service();
    outside.threads.push(held(1, 'Public'));
    panel(outside.client, OUTSIDER);
    await userEvent.click(await screen.findByRole('button', { name: /^Grace, .*comment/ }));
    await screen.findByRole('combobox', { name: 'Reply' });
    expect(screen.queryByRole('button', { name: 'Make internal' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Internal' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'New thread' }));
    expect(screen.getByLabelText('Comment')).toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', {
        name: 'Internal: nobody from outside the organisation sees it',
      }),
    ).toBeNull();
  });

  it('opens a card in place, one at a time, and answers it there; and across the panel from there', async () => {
    const { client, threads } = service();
    threads.push(held(1, 'Which tray?'), held(2, 'Which printer?'));
    panel(client);
    const first = await screen.findByRole('button', {
      name: /Grace.*1 comment/,
      expanded: false,
      description: 'Which tray?',
    });
    const second = screen.getByRole('button', { name: /Grace/, description: 'Which printer?' });
    await userEvent.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'true');
    const reply = await screen.findByRole('combobox', { name: 'Reply' });
    await userEvent.click(second);
    await waitFor(() => expect(second).toHaveAttribute('aria-expanded', 'true'));
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(reply).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('combobox', { name: 'Reply' }), 'The second{Enter}');
    await waitFor(() => expect(threads[1]!.comments).toHaveLength(2));
    await userEvent.click(screen.getByRole('button', { name: 'Open thread' }));
    expect(screen.getByRole('button', { name: 'All threads' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'The whole component' })).toBeInTheDocument();
  });

  it('steps through the threads shown with J and K, not while typing a reply, and Esc goes back', async () => {
    const { client, threads } = service();
    threads.push(held(1, 'Which tray?'), held(2, 'Which printer?'), held(3, 'Which paper?'));
    panel(client);
    await userEvent.click(
      await screen.findByRole('button', { name: /Grace/, description: 'Which printer?' }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Open thread' }));
    expect(screen.getByText('2 of 3 threads')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('combobox', { name: 'Reply' }), 'jk');
    expect(screen.getByText('2 of 3 threads')).toBeInTheDocument();
    await userEvent.clear(screen.getByRole('combobox', { name: 'Reply' }));
    screen.getByRole('button', { name: 'Copy link' }).focus();
    await userEvent.keyboard('j');
    expect(await screen.findByText('3 of 3 threads')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next thread' })).toBeDisabled();
    screen.getByRole('button', { name: 'Copy link' }).focus();
    await userEvent.keyboard('k');
    expect(await screen.findByText('2 of 3 threads')).toBeInTheDocument();
    screen.getByRole('button', { name: 'Copy link' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(
      await screen.findByRole('button', { name: /Grace/, description: 'Which printer?' }),
    ).toHaveFocus();
  });

  it('keeps a typed reply through Esc, closing the suggestions first', async () => {
    const { client, threads } = service();
    threads.push(held(1, 'Which tray?'));
    panel(client);
    await userEvent.click(await screen.findByRole('button', { name: /^Grace, .*comment/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Open thread' }));
    const box = screen.getByRole('combobox', { name: 'Reply' });
    await userEvent.type(box, 'Ask @gr');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('combobox', { name: 'Reply' })).toHaveValue('Ask @gr');
  });

  it('does not send on the Enter that ends composed words', async () => {
    const { client, threads } = service();
    threads.push(held(1, 'Which tray?'));
    panel(client);
    await userEvent.click(await screen.findByRole('button', { name: /^Grace, .*comment/ }));
    const box = await screen.findByRole('combobox', { name: 'Reply' });
    await userEvent.type(box, 'こんにちは');
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    expect(threads[0]!.comments).toHaveLength(1);
  });

  it('opens an address’s thread the filter hides, with no count or arrows', async () => {
    const { client, threads } = service();
    threads.push(
      held(1, 'Done with.', {
        resolution: { by: { id: ADA, name: 'Ada' }, at: '2026-10-12T11:00:00.000Z' },
      }),
    );
    render(
      <ThreadsPanel
        client={client}
        document={DOCUMENT}
        targets={[]}
        people={PEOPLE}
        principalId={ADA}
        mayAnswer={() => true}
        placeOf={() => '1 Method'}
        opening={{ thread: id(1), arrival: 1 }}
      />,
    );
    expect(await screen.findByRole('heading', { name: 'The whole component' })).toBeInTheDocument();
    expect(screen.queryByText(/of \d+ threads/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next thread' })).toBeNull();
    expect(screen.getByRole('button', { name: 'All threads' })).toBeInTheDocument();
  });

  it('keeps a mention’s place through editing a comment', async () => {
    const { client, threads } = service();
    panel(client);
    await screen.findByText('No threads here.');
    await startOn('Ask @gr{Enter}now');
    await screen.findByRole('heading', { name: '“the tray”' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const mine = screen.getByLabelText('Your comment');
    expect(mine).toHaveValue('Ask @Grace now');
    await userEvent.type(mine, ' please');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(threads[0]!.comments[0]!.texts).toHaveLength(2));
    expect(threads[0]!.comments[0]!.texts[1]!.parts).toEqual([
      { text: 'Ask ' },
      { mention: GRACE },
      { text: ' now please' },
    ]);
  });

  it('COL-071 filters to the threads a person is in, the strip and the search box one filter', async () => {
    const { client, threads } = service();
    threads.push(
      held(1, 'From Grace'),
      held(2, 'From Ada', {
        comments: [
          {
            id: id(301),
            author: { id: ADA, name: 'Ada' },
            at: '2026-10-12T10:00:00.000Z',
            texts: [{ parts: [{ text: 'From Ada' }], at: '2026-10-12T10:00:00.000Z' }],
          },
        ],
      }),
    );
    panel(client);
    const strip = await screen.findByRole('group', { name: 'Filter by person' });
    const grace = within(strip).getByRole('button', { name: 'Grace, 1 open' });
    await userEvent.click(grace);
    expect(grace).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('From Ada')).toBeNull();
    expect(screen.getByText('From Grace')).toBeInTheDocument();
    // Its chip in the search box; removing it clears both.
    await userEvent.click(screen.getByRole('button', { name: 'Remove Grace' }));
    expect(grace).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('From Ada')).toBeInTheDocument();
    // Chosen from the search, it presses the strip.
    const search = screen.getByRole('combobox', { name: 'Search, or @ for a person' });
    await userEvent.type(search, '@gr');
    const offered = screen.getByRole('listbox', { name: 'Filter by person' });
    expect(within(offered).getByRole('option', { name: /Grace/ })).toHaveTextContent('1 thread');
    await userEvent.keyboard('{Enter}');
    expect(grace).toHaveAttribute('aria-pressed', 'true');
    expect(search).toHaveValue('');
    expect(screen.queryByText('From Ada')).toBeNull();
    await userEvent.click(within(strip).getByRole('button', { name: 'All' }));
    await userEvent.type(search, 'from ada');
    expect(screen.queryByText('From Grace')).toBeNull();
    expect(screen.getByText('From Ada')).toBeInTheDocument();
  });

  it('COL-070 says which are new, marks one read as it opens, and all with one button', async () => {
    const { client, threads, asked } = service();
    threads.push(
      held(1, 'Which tray?', { new: true }),
      held(2, 'Which printer?', { new: true }),
      held(3, 'Read.'),
    );
    panel(client);
    expect(await screen.findByText('2 new')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /new$/, description: 'Which tray?' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /new$/, description: 'Which tray?' }));
    await screen.findByRole('combobox', { name: 'Reply' });
    expect(asked).toContain('POST /v1/threads/read');
    expect(screen.getByText('1 new')).toBeInTheDocument();
    const reads = asked.filter((each) => each === 'POST /v1/threads/read').length;
    const lists = asked.filter((each) => each.startsWith('GET /v1/documents')).length;
    await userEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));
    await waitFor(() =>
      expect(asked.filter((each) => each === 'POST /v1/threads/read')).toHaveLength(reads + 1),
    );
    expect(screen.queryByText(/\d new/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
    // Nothing read again: the list stands as it was.
    expect(asked.filter((each) => each.startsWith('GET /v1/documents'))).toHaveLength(lists);
  });

  it('GEN-063 marks a comment the assistant drafted, under the person who accepted it, naming the model where it is told', async () => {
    const { client, threads } = service();
    const drafted = held(1, 'Which tray?');
    drafted.comments[0]!.drafted = { model: 'stand-in-1' };
    const unnamed = held(2, 'Which printer?');
    unnamed.comments[0]!.drafted = { model: null };
    threads.push(drafted, unnamed);
    panel(client);
    const card = await screen.findByRole('button', { name: /Grace/, description: 'Which tray?' });
    expect(within(card).getByText('AI')).toBeInTheDocument();
    await userEvent.click(card);
    expect(await screen.findByText('Assistant drafted · stand-in-1')).toBeInTheDocument();
    expect(screen.getAllByText('Grace').length).toBeGreaterThan(0);
    await userEvent.click(
      screen.getByRole('button', { name: /Grace/, description: 'Which printer?' }),
    );
    expect(await screen.findByText('Assistant drafted')).toBeInTheDocument();
    // Its filter finds what it drafted; it is no person to be named in a comment.
    const strip = screen.getByRole('group', { name: 'Filter by person' });
    expect(within(strip).getByRole('button', { name: 'AI, 2 open' })).toBeInTheDocument();
    await userEvent.type(screen.getByRole('combobox', { name: 'Reply' }), '@as');
    expect(screen.queryByRole('option', { name: /Assistant/ })).toBeNull();
  });

  it('says Show’s choice in its name and counts each choice, the default Open', async () => {
    const { client, threads } = service();
    threads.push(
      held(1, 'Which tray?'),
      held(2, 'Done.', {
        resolution: { by: { id: ADA, name: 'Ada' }, at: '2026-10-12T11:00:00.000Z' },
      }),
    );
    panel(client);
    const show = await screen.findByRole('button', { name: 'Show: Open' });
    expect(screen.queryByText('Done.')).toBeNull();
    await userEvent.click(show);
    expect(screen.getByRole('menuitemradio', { name: /^All threads.*2$/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: /^Open.*1$/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});
