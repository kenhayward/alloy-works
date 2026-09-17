import { createApiClient } from '@alloy-works/api-client';
import { fromEditor, Selection, type EditorView } from '@alloy-works/editor';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
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

/**
 * Opens the editor. `strict` renders it inside `<StrictMode>`, which is how the application itself
 * runs it (apps/web/src/main.tsx) and which double-invokes every render: anything that keeps its
 * bearings by counting renders, rather than by comparing values, behaves differently there than it
 * does in a test that leaves StrictMode off (fix round 2, findings A-C).
 */
function open(answers: Record<string, Answer>, timing = quick, strict = false) {
  const { client, asked } = service(answers);
  let view: EditorView | undefined;
  const editor = (
    <ComponentEditor
      componentId={COMPONENT}
      client={client}
      principalId={ADA}
      sessionId={SESSION}
      timing={timing}
      onView={(mounted) => (view = mounted)}
    />
  );
  render(strict ? <StrictMode>{editor}</StrictMode> : editor);
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

  it('edits the title, the language and the direction above the surface, and sends them', async () => {
    // The first edit claims the lock at once, from `reading` (session.ts, `changed()`), so a service
    // that answers no lock route refuses the claim - and a refused claim puts the surface straight
    // back to the version (the same behaviour 'puts the surface back...' already exercises), silently
    // discarding every keystroke before the test ever reads the document. The default timing, not
    // `quick`, then keeps a save from firing mid-test until it is explicitly asked for: `quick`'s much
    // shorter idle window would need every intermediate iteration stubbed too, for no reason this test
    // cares about; `finish` (via Save version) flushes regardless of timing.
    const { asked, surface } = open(
      {
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
      },
      designTiming,
    );
    const view = await surface();
    const title = screen.getByLabelText('Title') as HTMLInputElement;

    // Selecting the whole field before typing over it, not `{selectall}` (S23's suggestion): that is
    // the legacy v13 pseudo-key and does nothing in the pinned user-event 14, which types are
    // selected with `initialSelectionStart`/`initialSelectionEnd` instead. The title input is
    // controlled by the document, and an empty value is refused, so a genuine clear() would put the
    // old title straight back and the following keystrokes would append to it instead of replacing.
    await userEvent.type(title, 'Replace the toner', {
      initialSelectionStart: 0,
      initialSelectionEnd: title.value.length,
    });
    // Waits for the claim itself to settle before touching the other fields: its own async resolution
    // otherwise races the language field's own refusal-then-cleared notice below, and whichever lands
    // last stomps the other, unreliably in either direction.
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('You are editing this component.'),
    );
    await userEvent.clear(screen.getByLabelText('Language'));
    await userEvent.type(screen.getByLabelText('Language'), 'fr-CA');
    await userEvent.selectOptions(screen.getByLabelText('Direction'), 'rtl');

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Replace the toner');
    // The fields themselves, not only the document they end up producing (review round 1, item 10).
    expect(screen.getByLabelText('Title')).toHaveValue('Replace the toner');
    expect(screen.getByLabelText('Language')).toHaveValue('fr-CA');
    // The document the session would send now carries all three, which is the whole of the header's
    // wiring - not only the title (review round 1, item 4).
    expect(fromEditor(view.state.doc)).toMatchObject({
      title: 'Replace the toner',
      language: 'fr-CA',
      direction: 'rtl',
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Save version' }));
    // The last PUT, not the first (fix round 2, minor): an idle save landing part-way through the
    // three edits would otherwise decide this assertion - passing or failing on which keystroke it
    // happened to catch rather than on what the header finally sent.
    await waitFor(() =>
      expect(asked.filter((each) => each.route.startsWith('PUT')).at(-1)?.body).toMatchObject({
        content: { title: 'Replace the toner', language: 'fr-CA', direction: 'rtl' },
      }),
    );
  });

  it('refuses to clear the title, saying why once the field is left, and leaves the document alone', async () => {
    const { surface } = open(
      { 'GET /v1/components/{id}': () => json(200, opened()) },
      designTiming,
      true,
    );
    const view = await surface();

    await userEvent.clear(screen.getByLabelText('Title'));
    fireEvent.blur(screen.getByLabelText('Title'));
    expect(screen.getByRole('status')).toHaveTextContent('A component needs a title.');
    // Leaving the field puts the document's title back in it. Clearing never reaches the document, so
    // `header.title` never changes and the value comparison that resyncs this field never fires -
    // nothing else in the page could put an empty input right, and it would sit over a component that
    // plainly has a title until the page was reloaded (re-review, finding 1).
    expect(screen.getByLabelText('Title')).toHaveValue('Install the printer');
    expect(fromEditor(view.state.doc).title).toBe('Install the printer');
  });

  it('leaves the field agreeing with the heading after a title is typed and then cleared', async () => {
    // Reverting to what the document holds now, not to what it held when the page opened - and the
    // heading is what a reader has in front of them, so the two must say the same thing. Left empty,
    // this field would stay empty through a version cut and through the surface going read-only,
    // because nothing changed the document and nothing else can resync it (re-review, finding 1).
    const { surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
      },
      designTiming,
      true,
    );
    const view = await surface();
    const field = screen.getByLabelText('Title');

    fireEvent.change(field, { target: { value: 'Replace the toner' } });
    await userEvent.clear(field);
    fireEvent.blur(field);

    expect(field).toHaveValue('Replace the toner');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Replace the toner');
    expect(fromEditor(view.state.doc).title).toBe('Replace the toner');
  });

  it('says nothing about a title being retyped, and never beside a title that is there, under StrictMode', async () => {
    // Clearing the field used to report "A component needs a title." and put the document's own
    // title straight back into the field in the same breath, so the message stood beside a perfectly
    // good title and nothing ever took it down again (final review, finding 3). Retyping a title is
    // an ordinary thing to do - select all, type the new one - and the language field already has
    // this shape: what is on its way somewhere is shown as typed and said nothing about.
    const { surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
      },
      designTiming,
      true,
    );
    const view = await surface();
    const field = screen.getByLabelText('Title');

    await userEvent.clear(field);
    expect(field).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('');

    fireEvent.change(field, { target: { value: 'Replace the toner' } });
    fireEvent.blur(field);

    expect(screen.getByRole('status')).not.toHaveTextContent('A component needs a title.');
    expect(field).toHaveValue('Replace the toner');
    expect(fromEditor(view.state.doc).title).toBe('Replace the toner');
  });

  it('does not report a refusal, or revert the field, for a no-op such as the same title with different surrounding space', async () => {
    // `setTitle` answers `false` not only when refused but also when the trimmed value already
    // matches the document (packages/editor/src/header.ts, `setRoot`) - a no-op, not a refusal, and
    // reporting it as one shows "A component needs a title." beside a title that plainly is not empty
    // (review round 1, item 2).
    const { surface } = open(
      { 'GET /v1/components/{id}': () => json(200, opened()) },
      designTiming,
    );
    await surface();

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Install the printer  ' },
    });

    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(screen.getByLabelText('Title')).toHaveValue('Install the printer  ');
  });

  it('does not report a refusal for a language tag still being typed, or once it is finished', async () => {
    // A tag under construction ("f", "fr-C") is not yet a BCP 47 tag, and validating - and reporting -
    // it on every keystroke shouts a refusal for text nobody has finished typing yet, which also never
    // clears once the tag it was building towards lands, because nothing here ever un-reports it
    // (review round 1, item 3). Reported on blur instead: nothing is said about a tag while it is
    // still being typed, whether or not what is there yet would parse, so finishing "fr-CA" - without
    // ever leaving the field - never shows a refusal for it to begin with.
    const { surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
      },
      designTiming,
    );
    await surface();
    const language = screen.getByLabelText('Language');

    fireEvent.change(language, { target: { value: 'f' } });
    expect(screen.getByRole('status')).toHaveTextContent('');

    fireEvent.change(language, { target: { value: 'fr-CA' } });
    expect(screen.getByRole('status')).not.toHaveTextContent('A language tag looks like en-GB.');

    fireEvent.blur(language);
    expect(screen.getByRole('status')).not.toHaveTextContent('A language tag looks like en-GB.');
  });

  it('reports a refused language tag once the field is left with one still incomplete', async () => {
    // Deliberately its own test, dispatching nothing at all (S23's own trap, one door over): a tag
    // that ever becomes valid claims the lock on its first accepted step, and that claim's own async
    // resolution would otherwise land at an unpredictable point relative to this test's own assertions.
    const { surface } = open(
      { 'GET /v1/components/{id}': () => json(200, opened()) },
      designTiming,
    );
    await surface();
    const language = screen.getByLabelText('Language');

    fireEvent.change(language, { target: { value: 'x' } });
    fireEvent.blur(language);

    expect(screen.getByRole('status')).toHaveTextContent('A language tag looks like en-GB.');
  });

  it('keeps the header in step with a document change it did not make itself, such as an undo', async () => {
    // The header's own fields buffer what was typed (so trimming and in-progress validation do not
    // corrupt live typing) but must still pick up a change that reaches the document some other way -
    // an undo reverting a `DocAttrStep` the same as this one - rather than going on showing what this
    // field last sent, which the next keystroke would then resend (review round 1, item 1).
    const { surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
      },
      designTiming,
    );
    const view = await surface();

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Replace the toner' } });
    expect(screen.getByLabelText('Title')).toHaveValue('Replace the toner');

    // What undo does mechanically - reverts the title's `DocAttrStep` through the same `view.dispatch`
    // path a real `Mod-z` keymap binding uses (packages/editor/src/state.ts) - without depending on
    // simulating a keyboard event through jsdom into a ProseMirror view, which this codebase's other
    // tests avoid for the same reason surface interaction here is done by transaction throughout. A
    // bare `view.dispatch` reaches React's state from outside its own event handling (the same reason
    // every other test in this file checking the DOM after one waits, rather than asserting straight
    // after it), so the DOM-facing assertions below are inside `waitFor` too.
    view.dispatch(view.state.tr.setDocAttribute('title', 'Install the printer'));

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Install the printer'),
    );
    expect(screen.getByLabelText('Title')).toHaveValue('Install the printer');
  });

  it('reflects a refusal that reverts the surface, not the title it was showing beforehand', async () => {
    // The same shape as 'puts the surface back and offers what was typed as text...', but through the
    // header: `onRefused` resets the view with `view.updateState`, which bypasses the `dispatch` hook
    // that otherwise keeps `header` in step, so without refreshing it there too, the heading and the
    // field would keep showing what was typed even after the surface itself discarded it (review
    // round 1, item 1).
    const { surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () =>
          json(409, {
            code: 'lock_held',
            message: 'held',
            traceId: 't',
            holder: { id: 'grace', name: 'Grace' },
            expectedRelease: '2026-09-16T09:15:00.000Z',
          }),
      },
      designTiming,
    );
    const view = await surface();

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Replace the toner' } });
    await screen.findByRole('textbox', { name: 'Text that was not saved' });

    expect(view.state.doc.attrs.title).toBe('Install the printer');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Install the printer');
    expect(screen.getByLabelText('Title')).toHaveValue('Install the printer');
  });

  it('disables the header fields once the surface itself goes read-only, such as in the lost phase', async () => {
    // The header's own `editable` must follow the surface's, `lost` among the phases it excludes
    // (review round 1, item 9) - `loaded.state === 'open'` alone does not change here, so a rule that
    // used only that would leave the fields editable while the surface itself has gone read-only.
    let putCount = 0;
    const { surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        'PUT /v1/components/{id}/iterations/{session}/1': () => {
          putCount += 1;
          return json(409, { code: 'iteration_stale', message: 'stale', traceId: 't', latest: 7 });
        },
      },
      quick,
    );
    const view = await surface();
    view.dispatch(view.state.tr.insertText(' Keep the box.', 19));
    await waitFor(() => expect(putCount).toBe(1));
    await screen.findByRole('button', { name: 'Continue' });

    expect(screen.getByLabelText('Title')).toBeDisabled();
  });

  it('shows the header for reading only where the caller may not edit', async () => {
    const { surface } = open({
      'GET /v1/components/{id}': () => json(200, opened({ mayEdit: false })),
    });
    await surface();

    expect(screen.getByLabelText('Title')).toBeDisabled();
  });

  it('keeps a trailing space in the title as it is typed, under StrictMode', async () => {
    // The application runs under `<StrictMode>` (apps/web/src/main.tsx), which renders every
    // component twice. A field that decides whether to resync itself by what happened during a
    // render loses that decision on the second pass and snaps back to the document (fix round 2,
    // finding A): a title is stored trimmed, so every interior space is trimmed away the instant it
    // is typed and is briefly trailing, and the field arrives at "Installtheprinter".
    const { surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
      },
      designTiming,
      true,
    );
    await surface();

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Install the printer ' } });

    expect(screen.getByLabelText('Title')).toHaveValue('Install the printer ');
  });

  it('keeps a language tag still being typed, under StrictMode', async () => {
    // The same defect, worse: only a complete tag ever reaches the document, so every keystroke of a
    // new one leaves the document's own language untouched - and a field that resyncs on the second
    // render pass puts "en-GB" straight back, making the language impossible to retype at all (fix
    // round 2, finding A).
    const { surface } = open(
      { 'GET /v1/components/{id}': () => json(200, opened()) },
      designTiming,
      true,
    );
    await surface();

    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'f' } });

    expect(screen.getByLabelText('Language')).toHaveValue('f');
  });

  it('does not revert a field being typed when something else re-renders the page', async () => {
    // Nothing about the header changed here: a paragraph was edited, which re-renders the page
    // through `header`, `session` and the notice alike. Such renders are routine - the claim
    // resolving, every save's saving/saved transition - and each one of them reverted an
    // in-progress value (fix round 2, finding B).
    const { surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
      },
      designTiming,
      true,
    );
    const view = await surface();

    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'fr-' } });
    view.dispatch(view.state.tr.insertText(' Keep the box.', 19));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('You are editing this component.'),
    );
    expect(screen.getByLabelText('Language')).toHaveValue('fr-');
  });

  it('leaves the language alone while the title is edited, and the title alone while the language is', async () => {
    // Each field answers for its own value only (fix round 2, finding C): editing one changed
    // `header`, and a field that resyncs on any change to it wiped the other's half-typed tag
    // silently, leaving a refusal standing over a value that was by then perfectly good.
    const { surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
      },
      designTiming,
      true,
    );
    await surface();

    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'fr-' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Replace the toner' } });

    expect(screen.getByLabelText('Language')).toHaveValue('fr-');
    expect(screen.getByLabelText('Title')).toHaveValue('Replace the toner');

    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'fr-CA' } });

    expect(screen.getByLabelText('Title')).toHaveValue('Replace the toner');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('You are editing this component.'),
    );
  });

  it('does not report a refused language tag when the field is disabled out from under it', async () => {
    // Disabling a focused input blurs it in a real browser, and the header goes read-only exactly
    // when the surface does - so the blur that arrives when the session is lost is the page changing
    // under the author, not the author leaving an unfinished tag behind. Reporting a refusal there
    // writes over the notice that just said what happened (fix round 2, finding H).
    let putCount = 0;
    const { surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        'PUT /v1/components/{id}/iterations/{session}/1': () => {
          putCount += 1;
          return json(409, { code: 'iteration_stale', message: 'stale', traceId: 't', latest: 7 });
        },
      },
      quick,
    );
    const view = await surface();
    const language = screen.getByLabelText('Language');
    fireEvent.change(language, { target: { value: 'fr-' } });

    view.dispatch(view.state.tr.insertText(' Keep the box.', 19));
    await waitFor(() => expect(putCount).toBe(1));
    await waitFor(() => expect(language).toBeDisabled());
    fireEvent.blur(language);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Newer text was saved from another window',
    );
    expect(screen.getByRole('status')).not.toHaveTextContent('A language tag looks like en-GB.');
  });
});
