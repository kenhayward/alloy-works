import { createApiClient } from '@alloy-works/api-client';
import type { EditorView } from '@alloy-works/editor';
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
    await waitFor(() =>
      expect(asked.map((each) => each.route)).toContain('DELETE /v1/components/{id}/lock'),
    );
  });
});
