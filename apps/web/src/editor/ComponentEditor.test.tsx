import { createApiClient } from '@alloy-works/api-client';
import { Selection, type EditorView } from '@alloy-works/editor';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ComponentEditor } from './ComponentEditor.js';
import { designTiming } from './session.js';

const COMPONENT = '6a0c1b8e-6f3e-4d2a-9d36-2a4f1c9e7b10';
const SESSION = '1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b';
const ADA = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

const content = (...texts: string[]) => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: texts.map((text, index) => ({
    type: 'paragraph',
    id: `b${index + 1}`,
    style: 'body',
    content: [{ type: 'text', value: text, marks: [] }],
  })),
});

const opened = (overrides: Record<string, unknown> = {}) => ({
  id: COMPONENT,
  space: { id: 's1', name: 'General' },
  version: {
    id: 'v1',
    number: '0.1',
    author: ADA,
    createdAt: '2026-09-16T09:00:00.000Z',
    note: null,
  },
  content: content('Unbox the printer.'),
  mayEdit: true,
  lock: null,
  ...overrides,
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** An answer, given by status and body, or a promise that never settles, to hold a phase in place. */
type Answer = (body: unknown) => Response | Promise<Response>;

/** The service as the editor meets it: answers by method and path, and remembers what was asked. */
function service(answers: Record<string, Answer>) {
  const asked: { route: string; body: unknown }[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const text =
      request.method === 'GET' || request.method === 'DELETE' ? '' : await request.text();
    const body = text === '' ? undefined : (JSON.parse(text) as unknown);
    const route = `${request.method} ${url.pathname.replace(COMPONENT, '{id}').replace(SESSION, '{session}')}`;
    asked.push({ route, body });
    const answer = answers[route];
    return answer ? answer(body) : json(404, { code: 'not_found', message: 'none', traceId: 't' });
  });
  const client = createApiClient({
    baseUrl: 'http://dev.acme.test',
    fetch: fetching as unknown as typeof fetch,
  });
  return { client, asked };
}

const quick = { ...designTiming, idleMs: 10, continuousMs: 50 };

function open(answers: Record<string, Answer>) {
  const { client, asked } = service(answers);
  let view: EditorView | undefined;
  render(
    <ComponentEditor
      componentId={COMPONENT}
      client={client}
      principalId={ADA}
      sessionId={SESSION}
      timing={quick}
      onView={(mounted) => (view = mounted)}
    />,
  );
  const surface = async () => {
    await screen.findByRole('textbox', { name: 'Content of Install the printer' });
    return view!;
  };
  return { asked, surface };
}

const lock = {
  holder: { id: ADA, name: 'Ada' },
  expectedRelease: '2026-09-16T09:15:00.000Z',
  yours: true,
  session: SESSION,
};

afterEach(() => vi.restoreAllMocks());

describe('the component editor', () => {
  it('opens the component on a spellchecked surface carrying its language and direction', async () => {
    const { surface } = open({ 'GET /v1/components/{id}': () => json(200, opened()) });
    await surface();
    const box = screen.getByRole('textbox', { name: 'Content of Install the printer' });
    expect(box).toHaveTextContent('Unbox the printer.');
    expect(box).toHaveAttribute('spellcheck', 'true');
    expect(box).toHaveAttribute('lang', 'en-GB');
    expect(box).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('heading', { name: 'Install the printer' })).toBeInTheDocument();
    expect(screen.getByText('Version 0.1 in General')).toBeInTheDocument();
  });

  it('claims the lock with the first change, saves it, and cuts a version when asked', async () => {
    const { asked, surface } = open({
      'GET /v1/components/{id}': () => json(200, opened()),
      'POST /v1/components/{id}/lock': () => json(200, { lock }),
      'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
      'POST /v1/components/{id}/versions': () =>
        json(200, {
          outcome: 'cut',
          version: {
            id: 'v2',
            number: '0.2',
            author: ADA,
            createdAt: '2026-09-16T09:05:00.000Z',
            note: null,
          },
        }),
    });
    const view = await surface();
    view.dispatch(view.state.tr.insertText(' Keep the box.', 19));

    await waitFor(() =>
      expect(asked.map((each) => each.route)).toContain(
        'PUT /v1/components/{id}/iterations/{session}/1',
      ),
    );
    const saved = asked.find((each) => each.route.startsWith('PUT'))!.body as {
      openedFrom: string;
      content: ReturnType<typeof content>;
    };
    expect(saved.openedFrom).toBe('v1');
    expect(saved.content).toEqual(content('Unbox the printer. Keep the box.'));
    expect(asked[1]).toEqual({
      route: 'POST /v1/components/{id}/lock',
      body: { session: SESSION },
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Save version' }));
    expect(await screen.findByText('Version 0.2 saved.')).toBeInTheDocument();
    expect(screen.getByText('Version 0.2 in General')).toBeInTheDocument();
    expect(asked.at(-1)).toEqual({
      route: 'POST /v1/components/{id}/versions',
      body: { session: SESSION, openedFrom: 'v1' },
    });
  });

  it('puts the surface back and offers what was typed as text when somebody else holds the component', async () => {
    const { surface } = open({
      'GET /v1/components/{id}': () => json(200, opened()),
      'POST /v1/components/{id}/lock': () =>
        json(409, {
          code: 'lock_held',
          message: 'This component is being edited in another session.',
          traceId: 't',
          holder: { id: 'grace', name: 'Grace' },
          expectedRelease: '2026-09-16T09:15:00.000Z',
        }),
    });
    const view = await surface();
    view.dispatch(view.state.tr.insertText(' Mine.', 19));

    expect(await screen.findByText('Grace is editing this component.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Text that was not saved' })).toHaveValue(
      'Unbox the printer. Mine.',
    );
    expect(view.state.doc.textContent).toBe('Unbox the printer.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('offers to continue here when the author holds the component in another window', async () => {
    const { asked, surface } = open({
      'GET /v1/components/{id}': () => json(200, opened()),
      'POST /v1/components/{id}/lock': (body) =>
        (body as { move?: boolean }).move
          ? json(200, { lock })
          : json(409, {
              code: 'lock_held',
              message: 'This component is being edited in another session.',
              traceId: 't',
              holder: { id: ADA, name: 'Ada' },
              expectedRelease: '2026-09-16T09:15:00.000Z',
            }),
    });
    const view = await surface();
    view.dispatch(view.state.tr.insertText('!', 19));
    await userEvent.click(await screen.findByRole('button', { name: 'Continue here' }));
    await waitFor(() =>
      expect(asked.at(-1)).toEqual({
        route: 'POST /v1/components/{id}/lock',
        body: { session: SESSION, move: true },
      }),
    );
    expect(await screen.findByText('You are editing this component.')).toBeInTheDocument();
  });

  it('says the author is signed out, keeps the unsaved text and stays editable when a save answers 401', async () => {
    let signedIn = false;
    const signedOut = () => json(401, { code: 'unauthenticated', message: 'no', traceId: 't' });
    const { asked, surface } = open({
      'GET /v1/components/{id}': () => json(200, opened()),
      'POST /v1/components/{id}/lock': () => json(200, { lock }),
      'PUT /v1/components/{id}/iterations/{session}/1': signedOut,
      'PUT /v1/components/{id}/iterations/{session}/2': signedOut,
      'PUT /v1/components/{id}/iterations/{session}/3': () =>
        signedIn ? json(200, { sequence: 3, lock }) : signedOut(),
    });
    const view = await surface();
    view.dispatch(view.state.tr.insertText(' Keep the box.', 19));
    expect(
      await screen.findByText(
        'You are signed out. Sign in again; your unsaved text is kept below.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Not saved')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Text that was not saved' })).toHaveValue(
      'Unbox the printer. Keep the box.',
    );
    expect(screen.getByRole('textbox', { name: 'Content of Install the printer' })).toHaveAttribute(
      'contenteditable',
      'true',
    );

    // Typing again while still signed out: the surface holds everything, so the kept text is replaced
    // by it rather than growing a second copy with every pause.
    view.dispatch(view.state.tr.insertText('!', view.state.doc.content.size - 1));
    await waitFor(() =>
      expect(asked.map((each) => each.route)).toContain(
        'PUT /v1/components/{id}/iterations/{session}/2',
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Text that was not saved' })).toHaveValue(
        'Unbox the printer. Keep the box.!',
      ),
    );

    signedIn = true;
    view.dispatch(view.state.tr.insertText('!', view.state.doc.content.size - 1));
    await waitFor(() => expect(screen.getByText('Saved at', { exact: false })).toBeInTheDocument());
    expect(screen.queryByRole('textbox', { name: 'Text that was not saved' })).toBeNull();
  });

  it('says edit permission was withdrawn and stops editing when a save answers 403', async () => {
    const { surface } = open({
      'GET /v1/components/{id}': () => json(200, opened()),
      'POST /v1/components/{id}/lock': () => json(200, { lock }),
      'PUT /v1/components/{id}/iterations/{session}/1': () =>
        json(403, { code: 'forbidden', message: 'no', traceId: 't' }),
    });
    const view = await surface();
    view.dispatch(view.state.tr.insertText(' Keep the box.', 19));
    expect(
      await screen.findByText(
        'You may no longer edit this component. Your unsaved text is kept below to copy.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Text that was not saved' })).toHaveValue(
      'Unbox the printer. Keep the box.',
    );
    expect(screen.getByRole('textbox', { name: 'Content of Install the printer' })).toHaveAttribute(
      'contenteditable',
      'false',
    );
  });

  it('refuses a paste rather than putting unexamined content into the component', async () => {
    const { asked, surface } = open({ 'GET /v1/components/{id}': () => json(200, opened()) });
    const view = await surface();
    const handled = view.someProp('handlePaste', (handle) =>
      handle(view, new Event('paste') as ClipboardEvent, view.state.doc.slice(1, 6)),
    );
    expect(handled).toBe(true);
    expect(
      await screen.findByText('Pasting is not available yet. Type the text instead.'),
    ).toBeInTheDocument();
    expect(asked.map((each) => each.route)).toEqual(['GET /v1/components/{id}']);
  });

  it('shows a component to a reader without letting them change it', async () => {
    const { surface } = open({
      'GET /v1/components/{id}': () => json(200, opened({ mayEdit: false })),
    });
    await surface();
    expect(screen.getByRole('textbox', { name: 'Content of Install the printer' })).toHaveAttribute(
      'contenteditable',
      'false',
    );
    expect(screen.getByText('You may read this component but not edit it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save version' })).toBeNull();
  });

  it('opens content this editor cannot change for reading only, saying what it holds', async () => {
    const withList = content('Before');
    withList.content.push({
      type: 'list',
      id: 'l1',
      kind: 'unordered',
      items: [
        {
          content: [
            {
              type: 'paragraph',
              id: 'i1',
              style: 'body',
              content: [{ type: 'text', value: 'Item', marks: [] }],
            },
          ],
        },
      ],
    } as never);
    open({ 'GET /v1/components/{id}': () => json(200, opened({ content: withList })) });
    expect(
      await screen.findByText(
        'This component holds content this editor cannot change yet (list), so it is shown for reading only.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('says there is nothing to open when the service answers not found', async () => {
    open({});
    expect(
      await screen.findByText('There is nothing here, or nothing you may read.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('says the component could not be opened, not that it is missing, when the service fails, and opens it on Try again', async () => {
    let attempts = 0;
    const { surface } = open({
      'GET /v1/components/{id}': () => {
        attempts += 1;
        return attempts === 1
          ? json(500, { code: 'internal', message: 'no', traceId: 't' })
          : json(200, opened());
      },
    });
    expect(await screen.findByText('The component could not be opened.')).toBeInTheDocument();
    expect(screen.queryByText('There is nothing here, or nothing you may read.')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await surface();
    expect(attempts).toBe(2);
  });

  it('says the component could not be opened when the request itself fails', async () => {
    open({
      'GET /v1/components/{id}': () => {
        throw new Error('network down');
      },
    });
    expect(await screen.findByText('The component could not be opened.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('says the author is signed out when opening answers 401', async () => {
    open({
      'GET /v1/components/{id}': () =>
        json(401, { code: 'unauthenticated', message: 'no', traceId: 't' }),
    });
    expect(
      await screen.findByText('You are signed out. Sign in again to open this component.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('refuses input while Done editing is releasing the lock (task 10, finding D)', async () => {
    let resolveRelease: (response: Response) => void = () => {};
    const { asked, surface } = open({
      'GET /v1/components/{id}': () => json(200, opened()),
      'POST /v1/components/{id}/lock': () => json(200, { lock }),
      'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
      'DELETE /v1/components/{id}/lock': () => new Promise((resolve) => (resolveRelease = resolve)),
    });
    const view = await surface();
    view.dispatch(view.state.tr.insertText(' Keep the box.', 19));
    await waitFor(() =>
      expect(asked.map((each) => each.route)).toContain(
        'PUT /v1/components/{id}/iterations/{session}/1',
      ),
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Done editing' }));
    await waitFor(() => {
      expect(
        screen.getByRole('textbox', { name: 'Content of Install the printer' }),
      ).toHaveAttribute('contenteditable', 'false');
    });

    resolveRelease(
      json(200, {
        outcome: 'cut',
        version: {
          id: 'v2',
          number: '0.2',
          author: ADA,
          createdAt: '2026-09-16T09:05:00.000Z',
          note: null,
        },
      }),
    );
    // Only true once the release has actually resolved and the session left `releasing` - `asked`
    // already held the DELETE route the instant the request was made, before it was ever answered, so
    // asserting that alone (fix round 1 minor) would have passed even without resolving it.
    await waitFor(() => {
      expect(
        screen.getByRole('textbox', { name: 'Content of Install the printer' }),
      ).toHaveAttribute('contenteditable', 'true');
    });
  });

  it('offers Continue after a stale save, and saves under a fresh session id once it succeeds (fix round 1 finding 1)', async () => {
    const asked: { route: string; body: unknown }[] = [];
    let putCount = 0;
    const sessionIdsSeen: string[] = [];
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      const text =
        request.method === 'GET' || request.method === 'DELETE' ? '' : await request.text();
      const body = text === '' ? undefined : (JSON.parse(text) as unknown);
      asked.push({ route: `${request.method} ${url.pathname}`, body });
      if (request.method === 'GET') return json(200, opened());
      if (request.method === 'POST' && url.pathname.endsWith('/lock')) return json(200, { lock });
      const match = /\/iterations\/([^/]+)\//.exec(url.pathname);
      if (request.method === 'PUT' && match) {
        putCount += 1;
        sessionIdsSeen.push(match[1]!);
        if (putCount === 1) {
          return json(409, { code: 'iteration_stale', message: 'stale', traceId: 't', latest: 7 });
        }
        return json(200, { sequence: 1, lock });
      }
      return json(404, { code: 'not_found', message: 'none', traceId: 't' });
    });
    const client = createApiClient({
      baseUrl: 'http://dev.acme.test',
      fetch: fetching as unknown as typeof fetch,
    });
    let view: EditorView | undefined;
    render(
      <ComponentEditor
        componentId={COMPONENT}
        client={client}
        principalId={ADA}
        sessionId={SESSION}
        timing={quick}
        onView={(mounted) => (view = mounted)}
      />,
    );
    await screen.findByRole('textbox', { name: 'Content of Install the printer' });
    view!.dispatch(view!.state.tr.insertText(' Keep the box.', 19));
    await waitFor(() => expect(putCount).toBe(1));
    expect(
      await screen.findByText(
        'Newer text was saved from another window, or from before this page was reloaded. ' +
          'It is kept. Continuing starts a new session from what is on screen.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Content of Install the printer' })).toHaveAttribute(
      'contenteditable',
      'false',
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await waitFor(() => {
      expect(
        screen.getByRole('textbox', { name: 'Content of Install the printer' }),
      ).toHaveAttribute('contenteditable', 'true');
    });

    view!.dispatch(view!.state.tr.insertText('!', view!.state.doc.content.size - 1));
    await waitFor(() => expect(putCount).toBe(2));
    expect(sessionIdsSeen[0]).toBe(SESSION);
    expect(sessionIdsSeen[1]).not.toBe(SESSION);
  });

  it('does not append the on-screen text again when a refused Continue follows a lost already holding it (fix round 2 minor)', async () => {
    let lockCalls = 0;
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      if (request.method === 'GET') return json(200, opened());
      if (request.method === 'POST' && url.pathname.endsWith('/lock')) {
        lockCalls += 1;
        if (lockCalls === 1) return json(200, { lock });
        return json(409, {
          code: 'lock_held',
          message: 'held',
          traceId: 't',
          holder: { id: 'grace', name: 'Grace' },
          expectedRelease: '2026-09-16T09:15:00.000Z',
        });
      }
      if (request.method === 'PUT' && url.pathname.includes('/iterations/')) {
        return json(409, { code: 'iteration_stale', message: 'stale', traceId: 't', latest: 7 });
      }
      return json(404, { code: 'not_found', message: 'none', traceId: 't' });
    });
    const client = createApiClient({
      baseUrl: 'http://dev.acme.test',
      fetch: fetching as unknown as typeof fetch,
    });
    let view: EditorView | undefined;
    render(
      <ComponentEditor
        componentId={COMPONENT}
        client={client}
        principalId={ADA}
        sessionId={SESSION}
        timing={quick}
        onView={(mounted) => (view = mounted)}
      />,
    );
    await screen.findByRole('textbox', { name: 'Content of Install the printer' });
    view!.dispatch(view!.state.tr.insertText(' Keep the box.', 19));
    await screen.findByRole('textbox', { name: 'Text that was not saved' });
    const keptAfterLost = (
      screen.getByRole('textbox', { name: 'Text that was not saved' }) as HTMLTextAreaElement
    ).value;
    expect(keptAfterLost).toBe('Unbox the printer. Keep the box.');

    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await screen.findByRole('button', { name: 'Try again' });
    expect(
      (screen.getByRole('textbox', { name: 'Text that was not saved' }) as HTMLTextAreaElement)
        .value,
    ).toBe(keptAfterLost);
  });

  it('offers Try again after a claim merely times out, not only after lock_held (fix round 1 finding 2)', async () => {
    const { client } = service({
      'GET /v1/components/{id}': () => json(200, opened()),
      'POST /v1/components/{id}/lock': () => new Promise(() => {}),
    });
    let view: EditorView | undefined;
    render(
      <ComponentEditor
        componentId={COMPONENT}
        client={client}
        principalId={ADA}
        sessionId={SESSION}
        timing={{ ...quick, claimMs: 20 }}
        onView={(mounted) => (view = mounted)}
      />,
    );
    await screen.findByRole('textbox', { name: 'Content of Install the printer' });
    view!.dispatch(view!.state.tr.insertText(' Mine.', 19));
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('appends what was typed across repeated refusals instead of replacing it (fix round 1 finding 2)', async () => {
    let refusals = 0;
    const { surface } = open({
      'GET /v1/components/{id}': () => json(200, opened()),
      'POST /v1/components/{id}/lock': () => {
        refusals += 1;
        return json(409, {
          code: 'lock_held',
          message: 'held',
          traceId: 't',
          holder: { id: 'grace', name: 'Grace' },
          expectedRelease: '2026-09-16T09:15:00.000Z',
        });
      },
    });
    const view = await surface();
    view.dispatch(view.state.tr.insertText(' Mine.', 19));
    await screen.findByRole('textbox', { name: 'Text that was not saved' });
    expect(screen.getByRole('textbox', { name: 'Text that was not saved' })).toHaveValue(
      'Unbox the printer. Mine.',
    );

    // A bare Try again - nothing typed since - has nothing new to lose, and must not add another copy
    // of the unchanged, already saved version to the kept text (fix round 2, finding 1).
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(refusals).toBe(2));
    expect(screen.getByRole('textbox', { name: 'Text that was not saved' })).toHaveValue(
      'Unbox the printer. Mine.',
    );

    view.dispatch(view.state.tr.insertText(' Again.', 19));
    await waitFor(() => {
      const kept = screen.getByRole('textbox', {
        name: 'Text that was not saved',
      }) as HTMLTextAreaElement;
      expect(kept.value).toBe('Unbox the printer. Mine.\n\nUnbox the printer. Again.');
    });
  });

  it('says not saved, not "no unsaved changes", once a claim is refused with text kept (fix round 1 finding 3)', async () => {
    const { surface } = open({
      'GET /v1/components/{id}': () => json(200, opened()),
      'POST /v1/components/{id}/lock': () =>
        json(409, {
          code: 'lock_held',
          message: 'held',
          traceId: 't',
          holder: { id: 'grace', name: 'Grace' },
          expectedRelease: '2026-09-16T09:15:00.000Z',
        }),
    });
    const view = await surface();
    view.dispatch(view.state.tr.insertText(' Mine.', 19));
    await screen.findByRole('textbox', { name: 'Text that was not saved' });
    expect(screen.getByText('Not saved')).toBeInTheDocument();
    expect(screen.queryByText('No unsaved changes')).toBeNull();
  });

  it('warns before an unmount while a change is unsaved, and stops once it is not (fix round 1 finding 4)', async () => {
    const { surface } = open({
      'GET /v1/components/{id}': () => json(200, opened()),
      'POST /v1/components/{id}/lock': () => json(200, { lock }),
      'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
    });
    const view = await surface();
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    view.dispatch(view.state.tr.insertText(' Keep the box.', 19));
    await waitFor(() => expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function)));
    const handler = addSpy.mock.calls.find(([name]) => name === 'beforeunload')![1] as (
      event: Event,
    ) => void;
    const event = new Event('beforeunload', { cancelable: true });
    handler(event);
    expect(event.defaultPrevented).toBe(true);

    await waitFor(() => expect(screen.getByText('Saved at', { exact: false })));
    await waitFor(() => expect(removeSpy).toHaveBeenCalledWith('beforeunload', handler));
  });

  it('warns before an unmount while kept text exists, even with nothing dirty or saving (fix round 2 minor)', async () => {
    const { surface } = open({
      'GET /v1/components/{id}': () => json(200, opened()),
      'POST /v1/components/{id}/lock': () =>
        json(409, {
          code: 'lock_held',
          message: 'held',
          traceId: 't',
          holder: { id: 'grace', name: 'Grace' },
          expectedRelease: '2026-09-16T09:15:00.000Z',
        }),
    });
    const view = await surface();
    view.dispatch(view.state.tr.insertText(' Mine.', 19));
    await screen.findByRole('textbox', { name: 'Text that was not saved' });
    // Nothing is dirty (the surface went back to the version) and nothing is saving or retrying -
    // only the kept text itself says there is something a close would still lose.
    await waitFor(() => expect(screen.getByText('Not saved')).toBeInTheDocument());
    // A real event dispatch, not a captured handler reference (fix round 3): the guard must still be
    // registered with `window` now that the refusal has settled, not merely have been registered at
    // some earlier moment (during `claiming`, briefly dirty) and then torn down without a replacement
    // - which a check against the mock's call history alone would not have told apart from this.
    // Inside waitFor: the guard registers in an effect after the render that shows the textarea.
    await waitFor(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });
  });

  it('keeps warning before an unmount while a retry is failing (fix round 2 minor)', async () => {
    const { client } = service({
      'GET /v1/components/{id}': () => json(200, opened()),
      'POST /v1/components/{id}/lock': () => json(200, { lock }),
      'PUT /v1/components/{id}/iterations/{session}/1': () =>
        json(500, { code: 'failed', message: 'no', traceId: 't' }),
    });
    let view: EditorView | undefined;
    render(
      <ComponentEditor
        componentId={COMPONENT}
        client={client}
        principalId={ADA}
        sessionId={SESSION}
        timing={{ ...quick, failingMs: 20 }}
        onView={(mounted) => (view = mounted)}
      />,
    );
    await screen.findByRole('textbox', { name: 'Content of Install the printer' });
    const addSpy = vi.spyOn(window, 'addEventListener');
    view!.dispatch(view!.state.tr.insertText(' Keep the box.', 19));
    await screen.findByText('Not saved, retrying');
    await waitFor(() => expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function)));
  });

  it('flushes an unsaved change on unmount instead of dropping it silently (fix round 1 finding 4)', async () => {
    const { asked, surface, unmount } = (() => {
      const { client, asked: requests } = service({
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
      });
      let view: EditorView | undefined;
      const result = render(
        <ComponentEditor
          componentId={COMPONENT}
          client={client}
          principalId={ADA}
          sessionId={SESSION}
          timing={quick}
          onView={(mounted) => (view = mounted)}
        />,
      );
      return {
        asked: requests,
        unmount: result.unmount,
        surface: async () => {
          await screen.findByRole('textbox', { name: 'Content of Install the printer' });
          return view!;
        },
      };
    })();
    const view = await surface();
    view.dispatch(view.state.tr.insertText(' Keep the box.', 19));
    await waitFor(() =>
      expect(asked.map((each) => each.route)).toContain('POST /v1/components/{id}/lock'),
    );
    unmount();
    await waitFor(() =>
      expect(asked.map((each) => each.route)).toContain(
        'PUT /v1/components/{id}/iterations/{session}/1',
      ),
    );
  });

  it('does not tear down the session when a parent passes a new inline onView (fix round 1 finding 5)', async () => {
    const { client, asked } = service({
      'GET /v1/components/{id}': () => json(200, opened()),
      'POST /v1/components/{id}/lock': () => json(200, { lock }),
      'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
    });
    let view: EditorView | undefined;
    const { rerender } = render(
      <ComponentEditor
        componentId={COMPONENT}
        client={client}
        principalId={ADA}
        sessionId={SESSION}
        timing={quick}
        onView={(mounted) => (view = mounted)}
      />,
    );
    await screen.findByRole('textbox', { name: 'Content of Install the printer' });
    view!.dispatch(view!.state.tr.insertText(' Keep the box.', 19));
    await waitFor(() =>
      expect(asked.map((each) => each.route)).toContain(
        'PUT /v1/components/{id}/iterations/{session}/1',
      ),
    );
    const claimsBefore = asked.filter((each) => each.route.endsWith('/lock')).length;

    // A fresh inline function every render, as a parent that does not memoise its callback would
    // produce - a real remount would tear the surface down and rebuild it from the original content,
    // losing what was just typed and firing a second claim.
    rerender(
      <ComponentEditor
        componentId={COMPONENT}
        client={client}
        principalId={ADA}
        sessionId={SESSION}
        timing={quick}
        onView={(mounted) => (view = mounted)}
      />,
    );

    expect(
      screen.getByRole('textbox', { name: 'Content of Install the printer' }),
    ).toHaveTextContent('Unbox the printer. Keep the box.');
    expect(asked.filter((each) => each.route.endsWith('/lock')).length).toBe(claimsBefore);
  });

  it('stops showing a stale lock notice once the author has claimed or released it themselves (fix round 1 minor)', async () => {
    const { surface } = open({
      'GET /v1/components/{id}': () =>
        json(
          200,
          opened({ lock: { ...lock, yours: false, holder: { id: 'grace', name: 'Grace' } } }),
        ),
      'POST /v1/components/{id}/lock': () => json(200, { lock }),
      'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
      'DELETE /v1/components/{id}/lock': () =>
        json(200, {
          outcome: 'unchanged',
          version: { id: 'v1', number: '0.1', author: ADA, createdAt: 't', note: null },
        }),
    });
    const view = await surface();
    expect(screen.getByText('Grace is editing this component.')).toBeInTheDocument();

    view.dispatch(view.state.tr.insertText(' Keep the box.', 19));
    await waitFor(() => expect(screen.queryByText('Grace is editing this component.')).toBeNull());
    await userEvent.click(await screen.findByRole('button', { name: 'Done editing' }));
    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: 'Content of Install the printer' }),
      ).toHaveAttribute('contenteditable', 'true'),
    );
    // The stale GET-time lock said Grace held it; this author has since claimed and released it
    // themselves, so the notice must not reappear from that stale snapshot (fix round 1 minor).
    expect(screen.queryByText('Grace is editing this component.')).toBeNull();
  });

  it('keeps the selection after Save version instead of jumping to the start (fix round 1 minor)', async () => {
    const { surface } = open({
      'GET /v1/components/{id}': () => json(200, opened()),
      'POST /v1/components/{id}/lock': () => json(200, { lock }),
      'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
      'POST /v1/components/{id}/versions': () =>
        json(200, {
          outcome: 'cut',
          version: {
            id: 'v2',
            number: '0.2',
            author: ADA,
            createdAt: '2026-09-16T09:05:00.000Z',
            note: null,
          },
        }),
    });
    const view = await surface();
    view.dispatch(view.state.tr.insertText(' Keep the box.', 19));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save version' })).not.toBeDisabled(),
    );
    const at = view.state.doc.content.size - 1;
    view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(at))));
    expect(view.state.selection.from).toBe(at);

    await userEvent.click(screen.getByRole('button', { name: 'Save version' }));
    await screen.findByText('Version 0.2 saved.');
    expect(view.state.selection.from).toBe(at);
  });
});
