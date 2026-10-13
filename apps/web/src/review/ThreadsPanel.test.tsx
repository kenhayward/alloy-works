import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ThreadsPanel, type ReviewTarget } from './ThreadsPanel.js';

const DOCUMENT = 'dddddddd-0000-4000-8000-000000000001';
const COMPONENT = 'cccccccc-0000-4000-8000-000000000001';
const VERSION = 'cccccccc-0000-4000-8000-000000000002';
const ADA = 'aaaaaaaa-0000-4000-8000-000000000001';
const GRACE = 'aaaaaaaa-0000-4000-8000-000000000002';
const IVY = 'aaaaaaaa-0000-4000-8000-000000000003';
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
  resolution: { by: { id: string; name: string }; at: string } | null;
  comments: {
    id: string;
    author: { id: string; name: string };
    at: string;
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
    comments: thread.comments.length,
    lastAt: thread.comments[0]!.at,
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
    };
    if (url.pathname.endsWith('/threads')) {
      const made: Held = {
        id: id(threads.length + 1),
        anchor: body.anchor,
        on: { id: COMPONENT, kind: 'component' },
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

const panel = (client: ReturnType<typeof service>['client']) =>
  render(
    <ThreadsPanel
      client={client}
      document={DOCUMENT}
      targets={TARGETS}
      people={PEOPLE}
      principalId={ADA}
      mayAnswer={() => true}
      placeOf={() => '1 Method'}
    />,
  );

describe('the threads panel in Review', () => {
  it('CNT-157 starts a thread on the selected text, naming people, and says who could not be told', async () => {
    const { client, asked, threads } = service();
    panel(client);
    expect(await screen.findByText('No threads here.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Comment'), 'Is this right?');
    await userEvent.selectOptions(screen.getAllByLabelText('Mention')[0]!, 'Grace');
    await userEvent.selectOptions(screen.getAllByLabelText('Mention')[0]!, 'Ivy');
    await userEvent.click(screen.getByRole('button', { name: 'Start thread' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Not told, as they may not read this: Ivy.',
    );
    expect(asked).toContain(`POST /v1/components/${COMPONENT}/threads`);
    expect(threads[0]!.anchor).toEqual(TARGETS[0]!.anchor);
    expect(threads[0]!.comments[0]!.texts[0]!.parts).toEqual([
      { text: 'Is this right?' },
      { mention: GRACE },
      { mention: IVY },
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
    await userEvent.type(screen.getByLabelText('Comment'), 'Is this right?');
    await userEvent.click(screen.getByRole('button', { name: 'Start thread' }));
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
    await userEvent.selectOptions(screen.getByLabelText('On'), 'whole');
    await userEvent.type(screen.getByLabelText('Comment'), 'And this');
    await userEvent.click(screen.getByRole('button', { name: 'Start thread' }));
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
    await userEvent.selectOptions(screen.getByLabelText('On'), 'whole');
    await userEvent.type(screen.getByLabelText('Comment'), 'First');
    await userEvent.click(screen.getByRole('button', { name: 'Start thread' }));
    await screen.findByRole('heading', { name: 'The whole component' });

    await userEvent.type(screen.getByLabelText('Reply'), 'Yes');
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
    expect(screen.queryByLabelText('Reply')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();

    // A second thread: the list, paged by the service, holds both.
    await userEvent.click(screen.getByRole('button', { name: 'All threads' }));
    await userEvent.selectOptions(screen.getByLabelText('On'), 'selection');
    await userEvent.type(screen.getByLabelText('Comment'), 'Second');
    await userEvent.click(screen.getByRole('button', { name: 'Start thread' }));
    await screen.findByRole('heading', { name: '“the tray”' });
    await userEvent.click(screen.getByRole('button', { name: 'All threads' }));
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'all');
    expect(await screen.findByRole('button', { name: '“the tray”' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'The whole component' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'open');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'The whole component' })).toBeNull(),
    );
    expect(screen.getByRole('button', { name: '“the tray”' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'resolved');
    const listed = await screen.findByRole('button', { name: 'The whole component' });
    expect(within(listed.closest('li')!).getByText('Resolved')).toBeInTheDocument();
  });

  it('COL-067 lists a thread on a component since deleted as no longer there, and says why it does not open', async () => {
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
    const row = (await screen.findByRole('button', { name: 'The whole component' })).closest('li')!;
    expect(within(row).getByText('Its text is no longer there')).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'The whole component' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This has been deleted.');
  });
});
