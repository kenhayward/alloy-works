import { createApiClient } from '@alloy-works/api-client';
import { fromEditor, Selection, setListAttributes, type EditorView } from '@alloy-works/editor';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { shimRangeMeasurement } from '../test/range.js';
import { StatusProvider } from '../shell/Status.js';
import { ComponentEditor } from './ComponentEditor.js';
import { designTiming } from './session.js';

shimRangeMeasurement();

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
function open(
  answers: Record<string, Answer>,
  timing = quick,
  strict = false,
  extra: Partial<React.ComponentProps<typeof ComponentEditor>> = {},
) {
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
      {...extra}
    />
  );
  render(strict ? <StrictMode>{editor}</StrictMode> : editor);
  const surface = async () => {
    await screen.findByRole('textbox', { name: 'Content of Install the printer' });
    // ProseMirror puts the surface into the page itself, outside React, so the surface is there
    // before the render it asks for in the same breath - the header, which is state - has been
    // committed. Waiting only for the surface therefore lands inside that window often enough to
    // fail a slow machine: the article shows its fallback heading and no header fields at all, and
    // every `getByLabelText` a test runs next finds nothing. Waiting for a field the header renders
    // waits for that commit, and it is a field every component opened here has, editable or not.
    await screen.findByLabelText('Title');
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

/** A paste event carrying exactly these types, as a browser's `clipboardData` holds them. */
function pasteEvent(data: Record<string, string>): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { types: Object.keys(data), getData: (type: string) => data[type] ?? '' },
  });
  return event;
}

/** Selects from `anchor` to `head`, or puts the caret there when they are one position. */
function selectText(view: EditorView, anchor: number, head: number): void {
  act(() =>
    view.dispatch(
      view.state.tr.setSelection(
        Selection.fromJSON(view.state.doc, { type: 'text', anchor, head }),
      ),
    ),
  );
}

/**
 * The base language field, which lives in the language chip's popover: opened first if it is not.
 * Found as an input, because the Formatting toolbar's Language mark is a button of the same name.
 */
async function languageField(): Promise<HTMLElement> {
  const open = screen.queryByLabelText('Language', { selector: 'input' });
  if (open) return open;
  await userEvent.click(screen.getByRole('button', { name: /^Base language/ }));
  return screen.getByLabelText('Language', { selector: 'input' });
}

/** The base direction select, in the direction chip's popover, opened first if it is not. */
async function directionField(): Promise<HTMLElement> {
  const open = screen.queryByLabelText('Direction');
  if (open) return open;
  await userEvent.click(screen.getByRole('button', { name: /^Base direction/ }));
  return await directionField();
}

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
    expect(screen.getByText('0.1 · General')).toBeInTheDocument();
  });

  it('says how many blocks and words it holds as the tooltip of its version, and no F6 hint', async () => {
    const { surface } = open({
      'GET /v1/components/{id}': () =>
        json(200, opened({ content: content('Unbox the printer.', 'Plug it in now.') })),
    });
    await surface();
    expect(screen.getByText('0.1 · General')).toHaveAttribute('title', '2 blocks, 7 words');
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.queryByText(/F6 moves/)).toBeNull();
  });

  it('in place, shows its section number carrying its size, and Done closes it without a claim', async () => {
    const onDone = vi.fn();
    const { asked, surface } = open(
      { 'GET /v1/components/{id}': () => json(200, opened()) },
      quick,
      false,
      { number: '3', onDone },
    );
    await surface();
    expect(screen.getByText('3')).toHaveAttribute('title', '1 block, 3 words');
    const done = screen.getByRole('button', { name: 'Done editing' });
    expect(done).toBeEnabled();
    await userEvent.click(done);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(asked.map((each) => each.route)).toEqual(['GET /v1/components/{id}']);
  });

  it('in place, Done releases what was claimed and then closes', async () => {
    const onDone = vi.fn();
    const { asked, surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
        'DELETE /v1/components/{id}/lock': () =>
          json(200, {
            outcome: 'cut',
            version: { id: 'v2', number: '0.2', author: ADA, createdAt: 't', note: null },
          }),
      },
      quick,
      false,
      { onDone },
    );
    const view = await surface();
    view.dispatch(view.state.tr.insertText(' Keep the box.', 19));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Done editing' })).toBeEnabled());
    await waitFor(() =>
      expect(asked.map((each) => each.route)).toContain(
        'PUT /v1/components/{id}/iterations/{session}/1',
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Done editing' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(asked.map((each) => each.route)).toContain('DELETE /v1/components/{id}/lock');
  });

  it('shows its base language and direction as chips, each opening its field', async () => {
    const { surface } = open({
      'GET /v1/components/{id}': () => json(200, opened()),
      'POST /v1/components/{id}/lock': () => json(200, { lock }),
      'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
    });
    await surface();
    const chip = screen.getByRole('button', { name: 'Base language: en-GB' });
    expect(chip).toHaveTextContent('en-GB');
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Language', { selector: 'input' })).toBeNull();
    await userEvent.click(chip);
    expect(chip).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Language', { selector: 'input' })).toHaveValue('en-GB');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByLabelText('Language', { selector: 'input' })).toBeNull();
    expect(chip).toHaveFocus();

    await userEvent.selectOptions(await directionField(), 'rtl');
    expect(screen.getByRole('button', { name: 'Base direction: right to left' })).toHaveTextContent(
      'RTL',
    );
  });

  it('opened at a place in its text, puts the focus and the caret there', async () => {
    const { surface } = open(
      { 'GET /v1/components/{id}': () => json(200, opened()) },
      quick,
      false,
      { openAt: 6 },
    );
    const view = await surface();
    await waitFor(() => expect(view.hasFocus() || document.activeElement === view.dom).toBe(true));
    // The paragraph opens at 1, so the sixth character of its text is at 7.
    expect(view.state.selection.from).toBe(7);
  });

  it('says its notices through the status bar where the application has one, and nowhere else', async () => {
    const { client } = service({ 'GET /v1/components/{id}': () => json(200, opened()) });
    render(
      <StatusProvider>
        <ComponentEditor
          componentId={COMPONENT}
          client={client}
          principalId={ADA}
          sessionId={SESSION}
        />
      </StatusProvider>,
    );
    const title = await screen.findByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.tab();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(within(screen.getByRole('contentinfo')).getByRole('status')).toHaveTextContent(
      'A component needs a title.',
    );
  });

  it('tells the workspace which space the component it opened is in', async () => {
    const { client } = service({ 'GET /v1/components/{id}': () => json(200, opened()) });
    const onSpace = vi.fn();
    render(
      <ComponentEditor
        componentId={COMPONENT}
        client={client}
        principalId={ADA}
        sessionId={SESSION}
        timing={quick}
        onSpace={onSpace}
      />,
    );
    await screen.findByRole('textbox', { name: 'Content of Install the printer' });
    expect(onSpace).toHaveBeenCalledWith({ id: 's1', name: 'General' });
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
    expect(screen.getByText('0.2 · General')).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByTitle(/^Saved at/)).toBeInTheDocument());
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

  it('CNT-063 pastes through the admission pipeline, and says in a paste report what it changed', async () => {
    const { asked, surface } = open({
      'GET /v1/components/{id}': () => json(200, opened()),
      'POST /v1/components/{id}/lock': () => json(200, { lock }),
      'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
    });
    const view = await surface();
    selectText(view, 19, 19);
    view.dom.dispatchEvent(
      pasteEvent({
        'text/html':
          '<p> Keep <b>the</b> box.<img src="https://example.com/box.png"></p><script>steal()</script>',
        'text/plain': ' Keep the box.',
      }),
    );

    expect(view.state.doc.textContent).toBe('Unbox the printer.Keep the box.');
    await waitFor(() =>
      expect(asked.map((each) => each.route)).toContain(
        'PUT /v1/components/{id}/iterations/{session}/1',
      ),
    );
    // The paste was the first change, so it claimed the lock, and the claim's own sentence comes
    // with it rather than in place of it.
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'You are editing this component. Pasted. Some of it was changed or left out: the paste report says what.',
      ),
    );
    const report = screen.getByRole('region', { name: 'Paste report' });
    expect(
      within(report).getByText('An image was left out. Images cannot be pasted yet.'),
    ).toBeInTheDocument();
    expect(
      within(report).getByText('A script was removed. Scripts are never stored.'),
    ).toBeInTheDocument();
    // New identifiers are the pipeline's business: an author can neither see nor act on them.
    expect(report).not.toHaveTextContent('identifiers');

    await userEvent.click(within(report).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('region', { name: 'Paste report' })).toBeNull();
    expect(view.hasFocus()).toBe(true);
  });

  it('says only that it pasted when there is nothing to report, and reaches the report by F6 when there is', async () => {
    const { surface } = open({
      'GET /v1/components/{id}': () => json(200, opened()),
      'POST /v1/components/{id}/lock': () => json(200, { lock }),
      'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
    });
    const view = await surface();
    selectText(view, 19, 19);
    view.dom.dispatchEvent(pasteEvent({ 'text/plain': ' Keep the box.' }));
    expect(view.state.doc.textContent).toBe('Unbox the printer. Keep the box.');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Pasted.$/));
    expect(screen.queryByRole('region', { name: 'Paste report' })).toBeNull();

    view.dom.dispatchEvent(pasteEvent({ 'text/html': '<h2>Tools</h2>' }));
    const report = await screen.findByRole('region', { name: 'Paste report' });
    view.focus();
    await userEvent.keyboard('{Shift>}{F6}{/Shift}');
    expect(within(report).getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('keeps a sentence it said until something new happens, rather than repeating its own at the next save', async () => {
    // Issue #196: the session publishes its notice with every change of state, and repeating it put
    // "You are editing this component." back over whatever the page had said since.
    const { asked, surface } = open({
      'GET /v1/components/{id}': () => json(200, opened()),
      'POST /v1/components/{id}/lock': () => json(200, { lock }),
      'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
      'PUT /v1/components/{id}/iterations/{session}/2': () => json(200, { sequence: 2, lock }),
    });
    const view = await surface();
    act(() => view.dispatch(view.state.tr.insertText(' Keep', 19)));
    await waitFor(() =>
      expect(asked.map((each) => each.route)).toContain(
        'PUT /v1/components/{id}/iterations/{session}/1',
      ),
    );
    expect(screen.getByRole('status')).toHaveTextContent('You are editing this component.');
    act(() => {
      view.someProp('handleDrop', (handle) =>
        handle(view, new Event('drop') as DragEvent, view.state.doc.slice(1, 6), false),
      );
    });
    act(() => view.dispatch(view.state.tr.insertText(' it', 24)));
    await waitFor(() =>
      expect(asked.map((each) => each.route)).toContain(
        'PUT /v1/components/{id}/iterations/{session}/2',
      ),
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Dragging content in is not available yet. Copy and paste it instead.',
    );
  });

  it('pastes the clipboard as Markdown from the toolbar, keeping its structure', async () => {
    const readText = vi.fn(async () => '**Keep** the box.');
    Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true });
    const { asked, surface } = open({
      'GET /v1/components/{id}': () => json(200, opened()),
      'POST /v1/components/{id}/lock': () => json(200, { lock }),
      'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
    });
    const view = await surface();
    selectText(view, 19, 19);
    await userEvent.click(screen.getByRole('button', { name: 'Paste as Markdown' }));

    await waitFor(() =>
      expect(asked.map((each) => each.route)).toContain(
        'PUT /v1/components/{id}/iterations/{session}/1',
      ),
    );
    expect(view.state.doc.textContent).toBe('Unbox the printer.Keep the box.');
    expect(view.dom.querySelector('strong')).toHaveTextContent('Keep');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'You are editing this component. Pasted.',
      ),
    );
    expect(view.hasFocus()).toBe(true);
  });

  it('says so when the clipboard cannot be read for Paste as Markdown, and pastes nothing', async () => {
    const readText = vi.fn(async () => {
      throw new DOMException('Read permission denied.', 'NotAllowedError');
    });
    Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true });
    const { asked, surface } = open({ 'GET /v1/components/{id}': () => json(200, opened()) });
    const view = await surface();
    await userEvent.click(screen.getByRole('button', { name: 'Paste as Markdown' }));
    expect(
      await screen.findByText(
        'The clipboard could not be read, so nothing was pasted. Allow this page to see the clipboard and try again.',
      ),
    ).toBeInTheDocument();
    expect(view.state.doc.textContent).toBe('Unbox the printer.');
    expect(asked.map((each) => each.route)).toEqual(['GET /v1/components/{id}']);
  });

  it('refuses a paste nothing can be read from, changing nothing and saying why', async () => {
    const { asked, surface } = open({ 'GET /v1/components/{id}': () => json(200, opened()) });
    const view = await surface();
    view.dom.dispatchEvent(pasteEvent({ 'image/png': 'not text' }));
    expect(
      await screen.findByText('Nothing was added, because the content could not be read.'),
    ).toBeInTheDocument();
    expect(view.state.doc.textContent).toBe('Unbox the printer.');
    expect(asked.map((each) => each.route)).toEqual(['GET /v1/components/{id}']);
  });

  it("copies in the product's own format, beside HTML and plain text, and changes nothing", async () => {
    const { asked, surface } = open({ 'GET /v1/components/{id}': () => json(200, opened()) });
    const view = await surface();
    selectText(view, 1, 6);
    const written = new Map<string, string>();
    const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        clearData: () => written.clear(),
        setData: (type: string, value: string) => written.set(type, value),
      },
    });
    view.dom.dispatchEvent(event);

    expect([...written.keys()].sort()).toEqual([
      'application/vnd.alloy-works.content+json',
      'text/html',
      'text/plain',
    ]);
    expect(written.get('text/plain')).toBe('Unbox');
    expect(JSON.parse(written.get('application/vnd.alloy-works.content+json')!)).toMatchObject({
      format: 'alloy-works/content',
      content: [{ type: 'paragraph', content: [{ value: 'Unbox' }] }],
    });
    expect(view.state.doc.textContent).toBe('Unbox the printer.');
    expect(asked.map((each) => each.route)).toEqual(['GET /v1/components/{id}']);
  });

  it('says which mark the selection already carries', async () => {
    // Moving the caret changes every answer the formatting toolbar gives and changes nothing else,
    // so a page that re-rendered only when the document changed would leave `aria-pressed` at
    // whatever it was when the surface mounted - which is a toolbar telling a screen reader the
    // wrong thing about the text the author is standing in (pre-flight F8).
    const emphasised = {
      ...content('Unbox the printer.'),
      content: [
        {
          type: 'paragraph',
          id: 'b1',
          style: 'body',
          content: [
            { type: 'text', value: 'Unbox', marks: [{ type: 'emphasis', id: 'm1' }] },
            { type: 'text', value: ' the printer.', marks: [] },
          ],
        },
      ],
    };
    const { surface } = open(
      { 'GET /v1/components/{id}': () => json(200, opened({ content: emphasised })) },
      quick,
      true,
    );
    const view = await surface();
    const emphasis = await screen.findByRole('button', { name: 'Emphasis' });

    act(() =>
      view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(10)))),
    );
    expect(emphasis).toHaveAttribute('aria-pressed', 'false');

    act(() => view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(3)))));
    expect(emphasis).toHaveAttribute('aria-pressed', 'true');
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
    // The formatting toolbar stays in the accessibility tree, reachable and inert: a reader can see
    // what the editor would do with the text without being able to do it.
    const formatting = screen.getByRole('toolbar', { name: 'Formatting' });
    for (const button of within(formatting).getAllByRole('button')) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
    }
  });

  it('opens content this editor cannot change for reading only, saying what it holds', async () => {
    // A figure: lists and tables are carried now, and this is about a block the editor still has no
    // node for.
    const withFigure = content('Before');
    withFigure.content.push({
      type: 'figure',
      id: 't1',
      asset: 'asset-1',
      imageStyle: 'wide',
      caption: [{ type: 'text', value: 'Readings', marks: [] }],
      alternative: { kind: 'decorative' },
    } as never);
    open({ 'GET /v1/components/{id}': () => json(200, opened({ content: withFigure })) });
    expect(
      await screen.findByText(
        'This component holds content this editor cannot change yet (figure), so it is shown for reading only.',
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
    expect(screen.queryByText('Saved')).toBeNull();
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

    await waitFor(() => expect(screen.getByTitle(/^Saved at/)));
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
    await screen.findByText('Not saved');
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
    await userEvent.clear(await languageField());
    await userEvent.type(await languageField(), 'fr-CA');
    await userEvent.selectOptions(await directionField(), 'rtl');

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Replace the toner');
    // The fields themselves, not only the document they end up producing (review round 1, item 10).
    expect(screen.getByLabelText('Title')).toHaveValue('Replace the toner');
    expect(await languageField()).toHaveValue('fr-CA');
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

  it('reverts a cleared title on blur even when the field is disabled out from under it', async () => {
    // The mirror image of 'does not report a refused language tag when the field is disabled out from
    // under it': an empty title is worse than an unfinished tag, because clearing it never reaches the
    // document (re-review, finding 1) - nothing but this field's own blur can put it right. The guard
    // that skips reporting a refusal while read-only used to skip the revert too: clear the title, lose
    // the session under it, and the field went disabled while still empty, sitting beside a heading
    // that kept showing the real title, with nothing left in the page able to correct it.
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
      true,
    );
    const view = await surface();
    const field = screen.getByLabelText('Title');
    fireEvent.change(field, { target: { value: '' } });
    expect(field).toHaveValue('');

    view.dispatch(view.state.tr.insertText(' Keep the box.', 19));
    await waitFor(() => expect(putCount).toBe(1));
    await waitFor(() => expect(field).toBeDisabled());
    fireEvent.blur(field);

    expect(field).toHaveValue('Install the printer');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Install the printer');
    // The notice that explained the lock loss is still the one showing, not overwritten and not
    // replaced by silence (finding H, re-applied here to the field it was not written for).
    expect(screen.getByRole('status')).toHaveTextContent(
      'Newer text was saved from another window',
    );
    expect(screen.getByRole('status')).not.toHaveTextContent('A component needs a title.');
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
    const language = await languageField();

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
    const language = await languageField();

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

  it('stops offering formatting once the surface goes read-only, such as in the lost phase', async () => {
    // The toolbar's `enabled` must follow the surface's own `editable`, `lost` among the phases it
    // excludes - and this one has teeth the header's does not: ProseMirror's `editable` stops what
    // an author types and stops nothing a command dispatches, so a toolbar left enabled here would
    // go on changing a document its author has been locked out of.
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
    // Something selected, so that a press which was allowed through would change the document
    // rather than merely storing a mark for the next keystroke.
    act(() =>
      view.dispatch(
        view.state.tr.setSelection(
          Selection.fromJSON(view.state.doc, { type: 'text', anchor: 1, head: 6 }),
        ),
      ),
    );
    const before = view.state.doc;

    const strong = screen.getByRole('button', { name: 'Strong' });
    expect(strong).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(strong);

    expect(view.state.doc.eq(before)).toBe(true);
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

    fireEvent.change(await languageField(), { target: { value: 'f' } });

    expect(await languageField()).toHaveValue('f');
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

    fireEvent.change(await languageField(), { target: { value: 'fr-' } });
    view.dispatch(view.state.tr.insertText(' Keep the box.', 19));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('You are editing this component.'),
    );
    expect(await languageField()).toHaveValue('fr-');
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

    fireEvent.change(await languageField(), { target: { value: 'fr-' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Replace the toner' } });

    expect(await languageField()).toHaveValue('fr-');
    expect(screen.getByLabelText('Title')).toHaveValue('Replace the toner');

    fireEvent.change(await languageField(), { target: { value: 'fr-CA' } });

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
    const language = await languageField();
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

/** The first paragraph's runs, as the stored model spells them and a save would send them. */
const runsOf = (view: EditorView) => {
  const [block] = fromEditor(view.state.doc).content;
  return block?.type === 'paragraph' ? block.content : [];
};

/** A selection over the surface, as a test makes one: jsdom cannot drag across text. */
const selectRange = (view: EditorView, anchor: number, head: number) =>
  act(() => {
    view.dispatch(
      view.state.tr.setSelection(
        Selection.fromJSON(view.state.doc, { type: 'text', anchor, head }),
      ),
    );
  });

/** One paragraph of stored content, given run by run rather than as plain text. */
const runs = (...inlines: unknown[]) => ({
  ...content(''),
  content: [{ type: 'paragraph', id: 'b1', style: 'body', content: inlines }],
});

describe('the link and language prompts', () => {
  it("is a modal carrying the command's icon, the text it goes on, and Cancel beside OK", async () => {
    const { surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
      },
      quick,
      true,
    );
    const view = await surface();
    selectRange(view, 1, 6);

    await userEvent.click(await screen.findByRole('button', { name: 'Link' }));
    const dialog = await screen.findByRole('dialog', { name: 'Link' });
    // The toolbar's own drawing, not a second copy of it, hidden from assistive technology.
    expect(
      within(dialog).getByRole('heading', { name: 'Link' }).querySelector('[data-icon]'),
    ).toHaveAttribute('data-icon', 'Link');
    expect(within(dialog).getByText('Unbox').tagName).toBe('MARK');
    expect(within(dialog).getByText(/The link goes on the selected text/)).toBeInTheDocument();
    const buttons = within(dialog)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent);
    expect(buttons).toEqual(['Cancel', 'OK', 'Close']);
    expect(within(dialog).getByLabelText('Title (optional)')).not.toHaveAttribute('placeholder');

    // The close button is Cancel by another name: nothing is applied.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(runsOf(view)[0]).toMatchObject({ value: 'Unbox the printer.', marks: [] });
  });

  it('cuts a long selection short rather than growing the dialog', async () => {
    const long = 'Unbox the printer, remove every piece of packing tape and keep the box.';
    const { surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened({ content: content(long) })),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
      },
      quick,
      true,
    );
    const view = await surface();
    selectRange(view, 1, 1 + long.length);
    await userEvent.click(await screen.findByRole('button', { name: 'Link' }));
    const dialog = await screen.findByRole('dialog', { name: 'Link' });
    expect(dialog.querySelector('mark')?.textContent).toBe(long.slice(0, 40).trimEnd() + '…');
  });

  it('links a selection to an address the author gives', async () => {
    const { surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
      },
      quick,
      true,
    );
    const view = await surface();
    selectRange(view, 1, 6);

    await userEvent.click(await screen.findByRole('button', { name: 'Link' }));
    await userEvent.type(await screen.findByLabelText('Address'), 'https://example.test/setup');
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() =>
      expect(runsOf(view)[0]).toMatchObject({
        type: 'text',
        value: 'Unbox',
        marks: [{ type: 'hyperlink', href: 'https://example.test/setup' }],
      }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('refuses an address whose scheme is not allowed, saying so, and applies nothing', async () => {
    const { surface } = open({ 'GET /v1/components/{id}': () => json(200, opened()) }, quick, true);
    const view = await surface();
    selectRange(view, 1, 6);

    await userEvent.click(await screen.findByRole('button', { name: 'Link' }));
    await userEvent.type(await screen.findByLabelText('Address'), 'javascript:alert(1)');
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    // Said where the author typed it, while the dialog is still open and the value still in the
    // box: a press that ended in nothing is the one thing they must not have to discover.
    expect(
      await screen.findByText('That address must begin http:, https: or mailto:.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Address')).toHaveValue('javascript:alert(1)');
    expect(runsOf(view)).toEqual([{ type: 'text', value: 'Unbox the printer.', marks: [] }]);
  });

  it('refuses a language tag that is not one, saying so, and applies nothing', async () => {
    const { surface } = open({ 'GET /v1/components/{id}': () => json(200, opened()) }, quick, true);
    const view = await surface();
    selectRange(view, 1, 6);

    await userEvent.click(await screen.findByRole('button', { name: 'Language' }));
    await userEvent.type(await screen.findByLabelText('Language tag'), 'klingon');
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(
      await screen.findByText('That is not a language tag. Try one like fr or pt-BR.'),
    ).toBeInTheDocument();
    expect(runsOf(view)).toEqual([{ type: 'text', value: 'Unbox the printer.', marks: [] }]);
  });

  it('takes a link off again from inside the dialog that shows it', async () => {
    // Link opens a dialog rather than toggling, so there is no second press to take one off with.
    const { surface } = open(
      {
        'GET /v1/components/{id}': () =>
          json(
            200,
            opened({
              content: runs(
                {
                  type: 'text',
                  value: 'Unbox',
                  marks: [{ type: 'hyperlink', id: 'a1', href: 'https://example.test/old' }],
                },
                { type: 'text', value: ' the printer.', marks: [] },
              ),
            }),
          ),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
      },
      quick,
      true,
    );
    const view = await surface();
    selectRange(view, 3, 3);

    await userEvent.click(await screen.findByRole('button', { name: 'Link' }));

    // Opened filled with what is there, and saying what Remove will do before it is pressed.
    expect(await screen.findByLabelText('Address')).toHaveValue('https://example.test/old');
    expect(
      screen.getByText('Remove takes this link off and leaves the text it was on.'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remove link' }));

    await waitFor(() =>
      expect(runsOf(view)).toEqual([{ type: 'text', value: 'Unbox the printer.', marks: [] }]),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the Link dialog from the keyboard alone', async () => {
    // `createEditorState` takes `onPrompt` as an option, so a renderer that passed none would leave
    // `Mod-k` doing nothing at all with no suite the wiser. This is the guard that it is passed.
    const { surface } = open({ 'GET /v1/components/{id}': () => json(200, opened()) }, quick, true);
    const view = await surface();
    await screen.findByRole('button', { name: 'Link' });
    selectRange(view, 1, 6);

    fireEvent.keyDown(view.dom, { key: 'k', ctrlKey: true });

    expect(await screen.findByRole('dialog', { name: 'Link' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Address')).toHaveFocus();
  });

  it('opens the Language dialog from the keyboard alone', async () => {
    const { surface } = open({ 'GET /v1/components/{id}': () => json(200, opened()) }, quick, true);
    const view = await surface();
    await screen.findByRole('button', { name: 'Language' });
    selectRange(view, 1, 6);

    // What a browser sends for Ctrl and Shift and L: an upper-case `key`, and the code the
    // keymap falls back to when the shifted spelling matches no binding.
    fireEvent.keyDown(view.dom, { key: 'L', keyCode: 76, ctrlKey: true, shiftKey: true });

    expect(await screen.findByRole('dialog', { name: 'Language' })).toBeInTheDocument();
  });

  it('does not ask for a target from the keyboard where there is nowhere to put one', async () => {
    // A cursor in unmarked text has nothing to link. Opening a dialog there would ask the author
    // for a target the command then drops, and the key is left to whatever else wants it.
    const { surface } = open({ 'GET /v1/components/{id}': () => json(200, opened()) }, quick, true);
    const view = await surface();
    await screen.findByRole('button', { name: 'Link' });
    selectRange(view, 8, 8);

    fireEvent.keyDown(view.dom, { key: 'k', ctrlKey: true });

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('returns the focus to what opened it when the author cancels', async () => {
    const { surface } = open({ 'GET /v1/components/{id}': () => json(200, opened()) }, quick, true);
    const view = await surface();
    selectRange(view, 1, 6);
    const link = await screen.findByRole('button', { name: 'Link' });
    link.focus();

    await userEvent.keyboard('{Enter}');

    const dialog = await screen.findByRole('dialog', { name: 'Link' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(await screen.findByLabelText('Address')).toHaveFocus();
    // Nothing there to take off, so nothing offers to.
    expect(screen.queryByRole('button', { name: 'Remove link' })).toBeNull();

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(link).toHaveFocus();
  });

  it('keeps the keyboard inside the dialog while it is open', async () => {
    // `aria-modal` says the rest of the page is not there for now, and a dialog that let Tab walk
    // out of it into a surface it is covering would be saying something untrue.
    const { surface } = open({ 'GET /v1/components/{id}': () => json(200, opened()) }, quick, true);
    const view = await surface();
    selectRange(view, 1, 6);
    await userEvent.click(await screen.findByRole('button', { name: 'Link' }));
    await screen.findByLabelText('Address');
    // The close button is the last stop, after the footer.
    const close = screen.getByRole('button', { name: 'Close' });

    close.focus();
    await userEvent.tab();
    expect(screen.getByLabelText('Address')).toHaveFocus();

    await userEvent.tab({ shift: true });
    expect(close).toHaveFocus();
  });

  it('CNT-098 asks the delivery to check spelling as the author types', async () => {
    const { surface } = open({ 'GET /v1/components/{id}': () => json(200, opened()) });
    await surface();

    expect(screen.getByRole('textbox', { name: 'Content of Install the printer' })).toHaveAttribute(
      'spellcheck',
      'true',
    );
  });

  it('CNT-147 does not ask the checker to check a run in another language', async () => {
    const { surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
        'PUT /v1/components/{id}/iterations/{session}/2': () => json(200, { sequence: 2, lock }),
      },
      quick,
      true,
    );
    const view = await surface();

    selectRange(view, 1, 6);
    await userEvent.click(await screen.findByRole('button', { name: 'Language' }));
    await userEvent.type(await screen.findByLabelText('Language tag'), 'fr');
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    selectRange(view, 11, 18);
    await userEvent.click(screen.getByRole('button', { name: 'Language' }));
    await userEvent.type(await screen.findByLabelText('Language tag'), 'en-GB');
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const box = screen.getByRole('textbox', { name: 'Content of Install the printer' });
    expect(box.querySelector('span[lang="fr"]')).toHaveTextContent('Unbox');
    expect(box.querySelector('span[lang="en-GB"]')).toHaveTextContent('printer');
    // Only the run whose language differs from the component's own is left unchecked: a passage in
    // the base language is still checked, mark or no mark.
    expect(
      [...box.querySelectorAll('[spellcheck="false"]')].map((each) => each.textContent),
    ).toEqual(['Unbox']);
  });

  it('carries the base language the author set, not the one the surface opened on', async () => {
    const { surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
        'PUT /v1/components/{id}/iterations/{session}/2': () => json(200, { sequence: 2, lock }),
      },
      quick,
      true,
    );
    const view = await surface();

    // A run in French, marked while the component itself is still English, so the checker leaves it
    // alone.
    selectRange(view, 1, 6);
    await userEvent.click(await screen.findByRole('button', { name: 'Language' }));
    await userEvent.type(await screen.findByLabelText('Language tag'), 'fr-FR');
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const box = screen.getByRole('textbox', { name: 'Content of Install the printer' });
    expect(box).toHaveAttribute('lang', 'en-GB');
    expect(
      [...box.querySelectorAll('[spellcheck="false"]')].map((each) => each.textContent),
    ).toEqual(['Unbox']);

    await userEvent.clear(await languageField());
    await userEvent.type(await languageField(), 'fr-FR');

    // The surface reads the document it is showing, not the one it mounted with. Frozen at the
    // opening value, the browser would check the whole component as English while the decorations
    // read the document that is now French - so the French run would lose its `spellcheck="false"`
    // and the English one would gain it, which is the answer to CNT-147 exactly inverted.
    await waitFor(() => expect(box).toHaveAttribute('lang', 'fr-FR'));
    expect(
      [...box.querySelectorAll('[spellcheck="false"]')].map((each) => each.textContent),
    ).toEqual([]);
  });

  it('carries the base direction the author set, not the one the surface opened on', async () => {
    const { surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
      },
      quick,
      true,
    );
    await surface();
    const box = screen.getByRole('textbox', { name: 'Content of Install the printer' });
    expect(box).toHaveAttribute('dir', 'ltr');

    await userEvent.selectOptions(await directionField(), 'rtl');

    // A component whose base direction is right to left and whose surface still renders left to
    // right shows the author the opposite of what the document says and of what a publish will do.
    await waitFor(() => expect(box).toHaveAttribute('dir', 'rtl'));
  });

  it('saves an iteration holding the marks the author applied', async () => {
    const { asked, surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
      },
      quick,
      true,
    );
    const view = await surface();
    selectRange(view, 1, 6);

    await userEvent.click(await screen.findByRole('button', { name: 'Link' }));
    await userEvent.type(await screen.findByLabelText('Address'), 'https://example.test/setup');
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() =>
      expect(asked.map((each) => each.route)).toContain(
        'PUT /v1/components/{id}/iterations/{session}/1',
      ),
    );
    const saved = asked.find((each) => each.route.startsWith('PUT'))!.body as {
      content: {
        content: { content: { marks: { type: string; id: string; href: string }[] }[] }[];
      };
    };
    const [mark] = saved.content.content[0]!.content[0]!.marks;
    expect(mark).toMatchObject({ type: 'hyperlink', href: 'https://example.test/setup' });
    // Minted by the editor, in the one spelling a block identifier takes (ADR-0023).
    expect(mark!.id).toMatch(/^[a-z2-7]{26}$/);
  });

  it('carries the title the author gave the link as well as its target', async () => {
    const { surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
      },
      quick,
      true,
    );
    const view = await surface();
    selectRange(view, 1, 6);

    await userEvent.click(await screen.findByRole('button', { name: 'Link' }));
    await userEvent.type(await screen.findByLabelText('Address'), 'https://example.test/setup');
    await userEvent.type(
      await screen.findByLabelText('Title (optional)'),
      'Setting the printer up',
    );
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() =>
      expect(runsOf(view)[0]).toMatchObject({
        type: 'text',
        value: 'Unbox',
        marks: [
          {
            type: 'hyperlink',
            href: 'https://example.test/setup',
            title: 'Setting the printer up',
          },
        ],
      }),
    );
  });

  it('applies what the author typed when they press Enter in a box', async () => {
    const { surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
      },
      quick,
      true,
    );
    const view = await surface();
    selectRange(view, 1, 6);

    await userEvent.click(await screen.findByRole('button', { name: 'Link' }));
    await userEvent.type(
      await screen.findByLabelText('Address'),
      'https://example.test/setup{Enter}',
    );

    await waitFor(() =>
      expect(runsOf(view)[0]).toMatchObject({
        type: 'text',
        value: 'Unbox',
        marks: [{ type: 'hyperlink', href: 'https://example.test/setup' }],
      }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says nothing was typed rather than complaining about a scheme', async () => {
    const { surface } = open({ 'GET /v1/components/{id}': () => json(200, opened()) }, quick, true);
    const view = await surface();
    selectRange(view, 1, 6);

    await userEvent.click(await screen.findByRole('button', { name: 'Link' }));
    await screen.findByLabelText('Address');
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(
      await screen.findByText('Type an address, or press Cancel to leave the text as it is.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('That address must begin http:, https: or mailto:.')).toBeNull();
    // The box that was refused says so, and says it before the hint rather than after it.
    const address = screen.getByLabelText('Address');
    expect(address).toHaveAttribute('aria-invalid', 'true');
    expect(address.getAttribute('aria-describedby')?.split(' ')).toEqual([
      'mark-prompt-hyperlink-complaint',
      'mark-prompt-hyperlink-hint-href',
    ]);
  });

  it('says so when the text a dialog was opened over has gone, and does not poison the next press', async () => {
    // The range gate is the first press's job. Re-asking it when a value comes back refused made a
    // moved selection close the dialog with nothing applied and nothing said - and left the refusal
    // standing, so the next ordinary press opened pre-filled and complaining about nobody's value.
    const { surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
      },
      quick,
      true,
    );
    const view = await surface();
    selectRange(view, 1, 6);

    await userEvent.click(await screen.findByRole('button', { name: 'Link' }));
    await userEvent.type(await screen.findByLabelText('Address'), 'https://example.test/setup');
    // A transaction from outside the dialog puts the cursor in unmarked text, so by the time the
    // command runs there is nowhere to put the mark.
    selectRange(view, 8, 8);
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(
      await screen.findByText(
        'That text is not there any more. Press Cancel, select some text, and try again.',
      ),
    ).toBeInTheDocument();
    expect(runsOf(view)).toEqual([{ type: 'text', value: 'Unbox the printer.', marks: [] }]);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    selectRange(view, 1, 6);
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));

    expect(await screen.findByLabelText('Address')).toHaveValue('');
    expect(screen.queryByText(/is not there any more/)).toBeNull();
    expect(screen.queryByText(/must begin http:/)).toBeNull();
  });

  it('says so when the mark a dialog offered to take off has gone', async () => {
    const { surface } = open(
      {
        'GET /v1/components/{id}': () =>
          json(
            200,
            opened({
              content: runs(
                {
                  type: 'text',
                  value: 'Unbox',
                  marks: [{ type: 'hyperlink', id: 'a1', href: 'https://example.test/old' }],
                },
                { type: 'text', value: ' the printer.', marks: [] },
              ),
            }),
          ),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
      },
      quick,
      true,
    );
    const view = await surface();
    selectRange(view, 3, 3);

    await userEvent.click(await screen.findByRole('button', { name: 'Link' }));
    await screen.findByLabelText('Address');
    // The linked text goes while the dialog stands over it, so there is nothing left to take off.
    act(() => view.dispatch(view.state.tr.delete(1, 6)));
    await userEvent.click(screen.getByRole('button', { name: 'Remove link' }));

    expect(
      await screen.findByText(
        'That text is not there any more. Press Cancel, select some text, and try again.',
      ),
    ).toBeInTheDocument();
  });

  it('leaves the page behind the dialog inert while it is open', async () => {
    // jsdom implements none of what `inert` does - focus still moves in and clicks still arrive -
    // so what can be pinned here is the attribute. What it buys in a browser is the reason the
    // dialog may say `aria-modal`: the surface behind cannot be clicked into, so the selection the
    // command is about to act on cannot move out from under the author while they type.
    const { surface } = open({ 'GET /v1/components/{id}': () => json(200, opened()) }, quick, true);
    const view = await surface();
    selectRange(view, 1, 6);
    const article = screen.getByRole('article');
    expect(article).not.toHaveAttribute('inert');

    await userEvent.click(await screen.findByRole('button', { name: 'Link' }));
    await screen.findByLabelText('Address');

    expect(article).toHaveAttribute('inert');

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(article).not.toHaveAttribute('inert');
  });

  it('goes on saying what happened while a dialog stands over the page', async () => {
    // What makes the page behind inert also takes it out of the accessibility tree, and the status
    // region is in there: a notice that arrives while a dialog is open - newer text saved from
    // another window, signed out, the lock lost - would be announced to nobody at all. It is not
    // polish; it is the sentence that says the author's work is in danger.
    const { surface } = open({ 'GET /v1/components/{id}': () => json(200, opened()) }, quick, true);
    const view = await surface();
    view.someProp('handleDrop', (handle) =>
      handle(view, new Event('drop') as DragEvent, view.state.doc.slice(1, 6), false),
    );
    await screen.findByText('Dragging content in is not available yet. Copy and paste it instead.');
    selectRange(view, 1, 6);

    await userEvent.click(await screen.findByRole('button', { name: 'Link' }));
    await screen.findByLabelText('Address');

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(
      'Dragging content in is not available yet. Copy and paste it instead.',
    );
    expect(status.closest('[inert]')).toBeNull();
  });

  it('says a mark has gone rather than the text, and offers nobody else the address', async () => {
    // Two mistakes that compounded: the remove path asserted that the text had gone, when what had
    // gone was the mark; and the boxes were refilled from a ref written only by Apply and never
    // cleared, so a refused Remove came back holding an address typed into a different dialog - one
    // that Apply would then have stored on text the author never meant.
    const { surface } = open(
      {
        'GET /v1/components/{id}': () =>
          json(
            200,
            opened({
              content: runs(
                { type: 'text', value: 'Unbox ', marks: [] },
                {
                  type: 'text',
                  value: 'the printer',
                  marks: [{ type: 'hyperlink', id: 'a1', href: 'https://example.test/old' }],
                },
              ),
            }),
          ),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
        'PUT /v1/components/{id}/iterations/{session}/2': () => json(200, { sequence: 2, lock }),
      },
      quick,
      true,
    );
    const view = await surface();

    // One address, typed and applied to the first run.
    selectRange(view, 1, 7);
    await userEvent.click(await screen.findByRole('button', { name: 'Link' }));
    await userEvent.type(await screen.findByLabelText('Address'), 'https://example.test/first');
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // A dialog over the other run's link, whose mark then goes while the dialog stands over it.
    selectRange(view, 7, 18);
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(await screen.findByLabelText('Address')).toHaveValue('https://example.test/old');
    act(() => view.dispatch(view.state.tr.removeMark(7, 18, view.state.schema.marks.hyperlink!)));
    await userEvent.click(screen.getByRole('button', { name: 'Remove link' }));

    // The text is plainly still there, so saying it has gone would be telling the author something
    // they can see is untrue.
    expect(
      await screen.findByText('There is no link here any more, so there is nothing to take off.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/is not there any more/)).toBeNull();
    expect(screen.getByLabelText('Address')).toHaveValue('');
  });

  it('CNT-152 names a language tag a publication cannot carry before the mark is applied', async () => {
    const { surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
      },
      quick,
      true,
    );
    const view = await surface();
    selectRange(view, 1, 6);

    await userEvent.click(await screen.findByRole('button', { name: 'Language' }));
    await userEvent.type(await screen.findByLabelText('Language tag'), 'zh-Hans');
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    // Said at the time and naming the tag, with the dialog still standing and nothing written: the
    // alternative is a component that looks fine until a publish somebody else asks for is refused.
    expect(
      await screen.findByText(
        'A publication cannot carry the tag zh-Hans. Press OK anyway to use it.',
      ),
    ).toBeInTheDocument();
    expect(runsOf(view)).toEqual([{ type: 'text', value: 'Unbox the printer.', marks: [] }]);

    // The button that now does something else is called something else, and carries the warning as
    // its description: a name that changed with the behaviour is heard on focus, where an alert
    // fired once is heard only by whoever was listening in that instant.
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
    const anyway = screen.getByRole('button', { name: 'OK anyway' });
    expect(anyway).toHaveAccessibleDescription(
      'A publication cannot carry the tag zh-Hans. Press OK anyway to use it.',
    );

    // A warning, not a refusal. The content model takes any well-formed tag, so the author who
    // means it presses again and it goes in.
    await userEvent.click(anyway);

    await waitFor(() =>
      expect(runsOf(view)[0]).toMatchObject({
        type: 'text',
        value: 'Unbox',
        marks: [{ type: 'language', tag: 'zh-Hans' }],
      }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says nothing about a language tag a publication can carry', async () => {
    const { surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
      },
      quick,
      true,
    );
    const view = await surface();
    selectRange(view, 1, 6);

    await userEvent.click(await screen.findByRole('button', { name: 'Language' }));
    await userEvent.type(await screen.findByLabelText('Language tag'), 'pt-BR');
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    // One press, nothing said: a warning every carriable tag also collected would be one nobody
    // reads by the third time they see it.
    await waitFor(() =>
      expect(runsOf(view)[0]).toMatchObject({
        type: 'text',
        value: 'Unbox',
        marks: [{ type: 'language', tag: 'pt-BR' }],
      }),
    );
    expect(screen.queryByText(/A publication cannot carry/)).toBeNull();
  });

  it('warns again when the tag is changed to another one a publication cannot carry', async () => {
    // The warning is spent on the value it was raised over, and on nothing else. A dialog that
    // counted presses instead would let the second tag through unremarked, and the author would be
    // told about the tag they corrected and not about the one they applied.
    const { surface } = open({ 'GET /v1/components/{id}': () => json(200, opened()) }, quick, true);
    const view = await surface();
    selectRange(view, 1, 6);

    await userEvent.click(await screen.findByRole('button', { name: 'Language' }));
    const box = await screen.findByLabelText('Language tag');
    await userEvent.type(box, 'zh-Hans');
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    await screen.findByText(/cannot carry the tag zh-Hans/);

    await userEvent.clear(box);
    await userEvent.type(box, 'es-419');

    // Corrected to something else the engine cannot carry: the complaint is about what is in the
    // box now, and the press that follows is the first press of that value, under the button's
    // ordinary name again.
    expect(screen.queryByText(/cannot carry the tag zh-Hans/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(
      await screen.findByText(
        'A publication cannot carry the tag es-419. Press OK anyway to use it.',
      ),
    ).toBeInTheDocument();
    expect(runsOf(view)).toEqual([{ type: 'text', value: 'Unbox the printer.', marks: [] }]);
  });

  it('spends a warning on one press of one value, not on a tag typed a second time', async () => {
    // A warning stood over by what is in the box would count a tag typed, corrected and typed again
    // as already answered: Apply would apply it with nothing said, though the author pressed nothing
    // over the value they are looking at. It is spent by a press, and any keystroke unspends it.
    const { surface } = open({ 'GET /v1/components/{id}': () => json(200, opened()) }, quick, true);
    const view = await surface();
    selectRange(view, 1, 6);

    await userEvent.click(await screen.findByRole('button', { name: 'Language' }));
    const box = await screen.findByLabelText('Language tag');
    await userEvent.type(box, 'zh-Hans');
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    await screen.findByText(/cannot carry the tag zh-Hans/);

    await userEvent.clear(box);
    await userEvent.type(box, 'zh-Hans');

    expect(screen.queryByText(/cannot carry the tag zh-Hans/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(await screen.findByText(/cannot carry the tag zh-Hans/)).toBeInTheDocument();
    expect(runsOf(view)).toEqual([{ type: 'text', value: 'Unbox the printer.', marks: [] }]);
  });

  it('refuses a tag the content model will not take rather than warning about a publication', async () => {
    // The two are different answers to different questions, and the warning must not stand in front
    // of the refusal: `klingon` is not a tag at all, so a publication carrying it is beside the
    // point and pressing Apply a second time would still end in nothing.
    const { surface } = open({ 'GET /v1/components/{id}': () => json(200, opened()) }, quick, true);
    const view = await surface();
    selectRange(view, 1, 6);

    await userEvent.click(await screen.findByRole('button', { name: 'Language' }));
    await userEvent.type(await screen.findByLabelText('Language tag'), 'klingon');
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(
      await screen.findByText('That is not a language tag. Try one like fr or pt-BR.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/A publication cannot carry/)).toBeNull();
    expect(runsOf(view)).toEqual([{ type: 'text', value: 'Unbox the printer.', marks: [] }]);
  });
});

/** Enough acknowledged saves that a panel test is never held up by a route nobody answered. */
const saves = Object.fromEntries(
  Array.from({ length: 8 }, (_, at) => [
    `PUT /v1/components/{id}/iterations/{session}/${at + 1}`,
    () => json(200, { sequence: at + 1, lock }),
  ]),
);

/** Just inside the block carrying that identifier, wherever the nesting has put it. */
const inside = (view: EditorView, id: string) => {
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (at !== -1) return false;
    if (node.attrs.id === id) at = pos + 1;
    return true;
  });
  if (at === -1) throw new Error(`no ${id} in this document`);
  return at;
};

/** Puts the cursor in the block carrying that identifier, and changes nothing else. */
const caretIn = (view: EditorView, id: string) =>
  act(() =>
    view.dispatch(
      view.state.tr.setSelection(Selection.near(view.state.doc.resolve(inside(view, id)))),
    ),
  );

/** What a number box really holds, rather than what jest-dom makes of an empty one. */
const shown = (box: HTMLElement) => (box as HTMLInputElement).value;

/** A stored document of whole blocks, where `content` above makes one paragraph per text. */
const blocksOf = (...blocks: unknown[]) => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: blocks,
});

const para = (id: string, text: string) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: [{ type: 'text', value: text, marks: [] }],
});

const listOf = (
  id: string,
  kind: 'ordered' | 'unordered',
  attrs: { start?: number; format?: string },
  ...blocks: unknown[]
) => ({ type: 'list', id, kind, ...attrs, items: blocks.map((block) => ({ content: [block] })) });

/** A bulleted list and a paragraph after it, for watching an announcement follow the caret. */
const aListAndAParagraph = blocksOf(
  listOf('L1', 'unordered', {}, para('b1', 'Unbox the printer.')),
  para('b2', 'Keep the box.'),
);

describe('the list panel', () => {
  /** A component of two paragraphs, open for editing, with everything a change needs answered. */
  const openTwoParagraphs = () => openWith(content('Unbox the printer.', 'Keep the box.'));

  /** The same, over whatever content a test needs. */
  const openWith = (stored: unknown) =>
    open(
      {
        'GET /v1/components/{id}': () => json(200, opened({ content: stored })),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        ...saves,
      },
      quick,
      true,
    );

  /** The first stored block, as a save would send it. */
  const firstBlock = (view: EditorView) => fromEditor(view.state.doc).content[0];

  it('shows the list panel only while the cursor is in a counted list, and sets its numbering', async () => {
    const { surface } = openTwoParagraphs();
    const view = await surface();
    await screen.findByRole('button', { name: 'Bulleted list' });
    expect(screen.queryByRole('group', { name: 'List' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Bulleted list' }));

    const panel = await screen.findByRole('group', { name: 'List' });
    const kind = within(panel).getByLabelText('Kind');
    expect(kind).toHaveValue('unordered');
    // Neither has anything to say about a bulleted list, so both are gone from the accessibility
    // tree rather than sitting there disabled - and `setListAttributes` refuses a start or a
    // numbering on a list that is not ordered, so a box left standing would be one that announced
    // itself as available and did nothing when it was used.
    expect(within(panel).queryByLabelText('Start at')).toBeNull();
    expect(within(panel).queryByLabelText('Numbering')).toBeNull();

    await userEvent.selectOptions(kind, within(kind).getByRole('option', { name: 'Numbered' }));
    const numbering = await screen.findByLabelText('Numbering');
    await userEvent.selectOptions(
      numbering,
      within(numbering).getByRole('option', { name: 'a, b, c' }),
    );
    expect(screen.getByText('The number the first item takes')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Start at'), '5');

    await waitFor(() =>
      expect(firstBlock(view)).toMatchObject({
        type: 'list',
        kind: 'ordered',
        start: 5,
        format: 'alphabetic',
      }),
    );

    // And it goes again when the cursor leaves the list: the panel is a region that comes and goes
    // with the selection, which nothing else in this view does.
    act(() =>
      view.dispatch(
        view.state.tr.setSelection(Selection.near(view.state.doc.resolve(inside(view, 'b2')))),
      ),
    );
    expect(screen.queryByRole('group', { name: 'List' })).toBeNull();
  });

  it('shows no list panel for a definition list, which has nothing to set', async () => {
    const { surface } = openTwoParagraphs();
    await surface();

    await userEvent.click(await screen.findByRole('button', { name: 'Definition list' }));

    // The cursor lands in the new item's term, so `listAt` says `definition`. A definition list
    // carries no start and no numbering, and its kind is the button that made it, so there is
    // nothing for a panel to hold: the absence is deliberate rather than an empty box.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Definition list' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    expect(screen.queryByRole('group', { name: 'List' })).toBeNull();
  });

  it('says why a start of 0 is refused on a lettered list, and changes nothing', async () => {
    const { surface } = openTwoParagraphs();
    const view = await surface();

    await userEvent.click(await screen.findByRole('button', { name: 'Numbered list' }));
    await screen.findByRole('group', { name: 'List' });
    // A zeroth item is a convention 1, 2, 3 has and letters and roman numerals do not, so the
    // start is taken here and only the numbering beside it makes it wrong.
    await userEvent.type(screen.getByLabelText('Start at'), '0');
    await waitFor(() => expect(firstBlock(view)).toMatchObject({ start: 0 }));

    const numbering = screen.getByLabelText('Numbering');
    await userEvent.selectOptions(
      numbering,
      within(numbering).getByRole('option', { name: 'a, b, c' }),
    );

    // The refusal arrives from the **numbering** field, which is the half a command judging only
    // the member it was handed would miss: the panel changes one field at a time, so a list left
    // at `start: 0, format: 'alphabetic'` would reach the author weeks later as the fixed message
    // a refused save carries, which names nothing.
    expect(
      await screen.findByText('Only a 1, 2, 3 list can start at 0. Try 1 or more.'),
    ).toBeInTheDocument();
    expect(firstBlock(view)).toMatchObject({ type: 'list', kind: 'ordered', start: 0 });
    expect(firstBlock(view)).not.toHaveProperty('format');
    expect(numbering).toHaveValue('decimal');
    // The sentence is about the pair; `aria-invalid` is about a control. It belongs on the one that
    // was refused - the **Numbering** select here - and not on the **Start at** box, whose own value
    // the model took and the list still holds. A box announcing itself invalid over a value the
    // document accepted sends an author to correct the one thing that is not wrong.
    expect(numbering).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Start at')).toHaveAttribute('aria-invalid', 'false');

    // And from the other side: a lettered list told to start at 0. Clearing the start first is
    // what makes the numbering acceptable, which also takes the refusal away.
    await userEvent.clear(screen.getByLabelText('Start at'));
    await userEvent.selectOptions(
      screen.getByLabelText('Numbering'),
      within(screen.getByLabelText('Numbering')).getByRole('option', { name: 'a, b, c' }),
    );
    await waitFor(() => expect(firstBlock(view)).toMatchObject({ format: 'alphabetic' }));
    expect(screen.queryByText('Only a 1, 2, 3 list can start at 0. Try 1 or more.')).toBeNull();

    await userEvent.type(screen.getByLabelText('Start at'), '0');

    expect(
      await screen.findByText('Only a 1, 2, 3 list can start at 0. Try 1 or more.'),
    ).toBeInTheDocument();
    expect(firstBlock(view)).not.toHaveProperty('start');
    // And the attribute follows the control back: the box was refused this time, the select holds
    // the numbering the model took.
    expect(screen.getByLabelText('Start at')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Numbering')).toHaveAttribute('aria-invalid', 'false');
  });

  it('leaves a refused start behind when the cursor moves to another list', async () => {
    // The announcement half of the defect this whole task exists to prevent, moved into the panel.
    // Two lists carrying no start look identical to a box that resyncs on the **value** alone, so
    // a refused `0` typed on the lettered one used to travel to the 1, 2, 3 one beside it - and
    // the box, its invalid state and the sentence under it then said three false things at once
    // about a list that holds no start and can perfectly well have one.
    const { surface } = openWith(
      blocksOf(
        listOf('L1', 'ordered', { format: 'alphabetic' }, para('b1', 'Unbox the printer.')),
        listOf('L2', 'ordered', {}, para('b2', 'Keep the box.')),
      ),
    );
    const view = await surface();
    await screen.findByRole('group', { name: 'List' });
    await userEvent.type(screen.getByLabelText('Start at'), '0');
    expect(
      await screen.findByText('Only a 1, 2, 3 list can start at 0. Try 1 or more.'),
    ).toBeInTheDocument();

    caretIn(view, 'b2');

    expect(shown(screen.getByLabelText('Start at'))).toBe('');
    expect(screen.getByLabelText('Start at')).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByText('Only a 1, 2, 3 list can start at 0. Try 1 or more.')).toBeNull();
    expect(screen.getByLabelText('Numbering')).toHaveValue('decimal');
    // Nothing was written either way: moving the caret is not a change to the document.
    expect(firstBlock(view)).not.toHaveProperty('start');
  });

  it('puts the start back in the box when something other than this field changes the list', async () => {
    const { surface } = openWith(
      blocksOf(listOf('L1', 'ordered', {}, para('b1', 'Unbox the printer.'))),
    );
    const view = await surface();
    await screen.findByRole('group', { name: 'List' });
    await userEvent.type(screen.getByLabelText('Start at'), '5');
    await waitFor(() => expect(firstBlock(view)).toMatchObject({ start: 5 }));

    // An undo, a version cut, and a refused claim putting the surface back to the version all
    // arrive the same way: the document's own value differs from the one this field last heard,
    // and the box gives way to it. Made here from outside the panel, which is the part that
    // matters - the field itself never resyncs on its own keystroke.
    act(() => {
      setListAttributes({ start: 9 })(view.state, view.dispatch.bind(view));
    });

    expect(shown(screen.getByLabelText('Start at'))).toBe('9');
  });

  it('says what is wrong with a start that is not a whole number, rather than dropping it in silence', async () => {
    // Left to the model alone this is two failures at once: the box keeps what was typed, the
    // document keeps something else, and nothing on screen says so. The sentence is its own,
    // because a complaint about 0 answers a question nobody asked about 1.5.
    const { surface } = openWith(
      blocksOf(listOf('L1', 'ordered', {}, para('b1', 'Unbox the printer.'))),
    );
    const view = await surface();
    await screen.findByRole('group', { name: 'List' });

    await userEvent.type(screen.getByLabelText('Start at'), '-1');

    expect(await screen.findByText('A start is a whole number, 0 or more.')).toBeInTheDocument();
    expect(screen.getByLabelText('Start at')).toHaveAttribute('aria-invalid', 'true');
    // And nothing reached the document: a start it already had is not cleared by a value it
    // refuses, which is what a guard that returned early used to do in silence.
    expect(firstBlock(view)).not.toHaveProperty('start');
    expect(screen.queryByText('Only a 1, 2, 3 list can start at 0. Try 1 or more.')).toBeNull();
  });

  it('says which kind of list the cursor stands in, and hears the caret move', async () => {
    // A selection-only transaction changes every answer a block button gives and changes nothing
    // else, which is the exact shape of the defect the marks slice was fixed for: a page that
    // re-rendered only on a document change would leave Bulleted list saying whatever it said
    // when the surface mounted.
    const { surface } = openWith(aListAndAParagraph);
    const view = await surface();
    const bulleted = await screen.findByRole('button', { name: 'Bulleted list' });
    const before = view.state.doc;
    expect(bulleted).toHaveAttribute('aria-pressed', 'true');

    caretIn(view, 'b2');
    expect(bulleted).toHaveAttribute('aria-pressed', 'false');

    caretIn(view, 'b1');
    expect(bulleted).toHaveAttribute('aria-pressed', 'true');
    expect(view.state.doc.eq(before)).toBe(true);
  });

  it('writes a term the author typed into the definition list it saves', async () => {
    const { asked, surface } = openTwoParagraphs();
    const view = await surface();

    await userEvent.click(await screen.findByRole('button', { name: 'Definition list' }));
    // jsdom cannot type into a ProseMirror surface, so the word arrives by transaction; Enter goes
    // through the view's own key handler, which is the route a keystroke really takes.
    act(() => view.dispatch(view.state.tr.insertText('Creep')));
    fireEvent.keyDown(view.dom, { key: 'Enter', keyCode: 13 });

    await waitFor(() => expect(asked.some((each) => each.route.startsWith('PUT'))).toBe(true));
    const saved = asked.filter((each) => each.route.startsWith('PUT')).at(-1)!.body as {
      content: { content: unknown[] };
    };
    expect(saved.content.content).toMatchObject([
      {
        type: 'list',
        kind: 'definition',
        items: [
          {
            term: [{ type: 'text', value: 'Creep', marks: [] }],
            // The paragraph that was wrapped keeps the identifier it went in with, so nothing
            // hanging on it is renamed by a button press (CNT-002).
            content: [{ type: 'paragraph', id: 'b1' }],
          },
        ],
      },
      { type: 'paragraph', id: 'b2' },
    ]);
  });
});

describe('the regions of the view', () => {
  /** The three things F6 lands on while a component is open for editing, in the ring's own order. */
  const landings = () => ({
    title: screen.getByLabelText('Title'),
    formatting: within(screen.getByRole('toolbar', { name: 'Formatting' })).getAllByRole(
      'button',
    )[0]!,
    text: screen.getByRole('textbox', { name: 'Content of Install the printer' }),
  });

  it('CNT-077 moves between the header, the toolbar, the list panel and the surface with F6 alone', async () => {
    const { surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        ...saves,
      },
      quick,
      true,
    );
    await surface();
    await screen.findByRole('button', { name: 'Link' });
    const { title, formatting, text } = landings();

    title.focus();
    await userEvent.keyboard('{F6}');
    expect(formatting).toHaveFocus();

    await userEvent.keyboard('{F6}');
    expect(text).toHaveFocus();
    // And no tab index of its own while it takes input: a surface being edited is focusable
    // already, and a `-1` would take it out of the tab order a Tab from the toolbar uses.
    expect(text).not.toHaveAttribute('tabindex');

    // A ring, not a line with two dead ends.
    await userEvent.keyboard('{F6}');
    expect(title).toHaveFocus();

    // The list panel is a fourth region while the cursor stands in a counted list, between the
    // toolbar and the surface, and it is reached the same way. It is the first region in this ring
    // that comes and goes: a press of Bulleted list adds a stop the author can reach with F6.
    await userEvent.click(screen.getByRole('button', { name: 'Bulleted list' }));
    const panel = await screen.findByRole('group', { name: 'List' });

    title.focus();
    await userEvent.keyboard('{F6}');
    expect(formatting).toHaveFocus();
    await userEvent.keyboard('{F6}');
    expect(within(panel).getByLabelText('Kind')).toHaveFocus();
    await userEvent.keyboard('{F6}');
    expect(text).toHaveFocus();
    await userEvent.keyboard('{F6}');
    expect(title).toHaveFocus();

    await userEvent.keyboard('{Shift>}{F6}{/Shift}');
    expect(text).toHaveFocus();
    await userEvent.keyboard('{Shift>}{F6}{/Shift}');
    expect(within(panel).getByLabelText('Kind')).toHaveFocus();

    // Save version and Done editing are not a region: they keep their own ordinary tab stops, and
    // F6 pressed from them enters the ring at its first region rather than cycling out of them.
    // They take the focus only once a change has claimed the lock, which the press above did.
    const save = await screen.findByRole('button', { name: 'Save version' });
    await waitFor(() => expect(save).toBeEnabled());

    save.focus();
    await userEvent.keyboard('{F6}');
    expect(title).toHaveFocus();
  });

  it('CNT-077 moves backwards between the regions with Shift-F6', async () => {
    const { surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
      },
      quick,
      true,
    );
    const view = await surface();
    await screen.findByRole('button', { name: 'Link' });
    const { title, formatting, text } = landings();

    title.focus();
    await userEvent.keyboard('{Shift>}{F6}{/Shift}');
    expect(text).toHaveFocus();

    await userEvent.keyboard('{Shift>}{F6}{/Shift}');
    expect(formatting).toHaveFocus();

    await userEvent.keyboard('{Shift>}{F6}{/Shift}');
    expect(title).toHaveFocus();

    // From outside the ring it enters at the last region, as F6 enters at the first: the author
    // who pressed it was going backwards, and dropping them at the second region of three would be
    // the ring guessing which one they meant to have left.
    act(() => view.dispatch(view.state.tr.insertText(' Keep the box.', 19)));
    const save = await screen.findByRole('button', { name: 'Save version' });
    await waitFor(() => expect(save).toBeEnabled());

    save.focus();
    await userEvent.keyboard('{Shift>}{F6}{/Shift}');
    expect(text).toHaveFocus();
  });

  it('lands on a region a reader cannot type in rather than skipping it', async () => {
    // A component being read has a header whose fields are disabled and a surface that takes no
    // input, so neither region holds anything a Tab would reach. Skipping them would leave F6
    // moving between one region and itself, and the reader with no way to reach the text at all.
    // What it lands on must still say what it is: a div with no role and no name announces nothing,
    // so the surface takes the focus on its own element and the header is a named group.
    const { surface } = open(
      { 'GET /v1/components/{id}': () => json(200, opened({ mayEdit: false })) },
      quick,
      true,
    );
    const view = await surface();
    const formatting = within(screen.getByRole('toolbar', { name: 'Formatting' })).getAllByRole(
      'button',
    )[0]!;

    // The toolbar is `aria-disabled` rather than disabled, which is what leaves the ring a place to
    // start from while nothing else in the view will take the focus.
    formatting.focus();
    await userEvent.keyboard('{F6}');
    expect(screen.getByRole('textbox', { name: 'Content of Install the printer' })).toHaveFocus();
    // jsdom focuses a `contenteditable="false"` element, which a browser does not, so the focus
    // above is not by itself evidence that this works outside a test. What makes it work is the
    // tab index the surface carries while it takes no input, and the attribute is what can be
    // pinned here - the same trade as `inert`, which jsdom does not implement either.
    expect(view.dom).not.toHaveAttribute('contenteditable', 'true');
    expect(view.dom).toHaveAttribute('tabindex', '-1');

    // The header's fields are disabled for a reader, but its chips are not: they open to show
    // the language and the direction, so the first of them is where the ring lands.
    await userEvent.keyboard('{F6}');
    expect(screen.getByRole('button', { name: 'Base language: en-GB' })).toHaveFocus();

    await userEvent.keyboard('{F6}');
    expect(formatting).toHaveFocus();
  });

  it('lands on the list panel itself where a reader cannot use its fields', async () => {
    // The panel's controls are `disabled` rather than `aria-disabled`, which is the header's
    // convention and not the toolbar's: the ARIA toolbar pattern is why a toolbar keeps its
    // buttons reachable, and a form group is not a toolbar. What that costs is a region holding
    // nothing a Tab can reach, and `land`'s fallback is what pays it - asserted for the header
    // already, and now for the panel, which is the other region that can empty out this way.
    const { surface } = open(
      {
        'GET /v1/components/{id}': () =>
          json(200, opened({ mayEdit: false, content: aListAndAParagraph })),
      },
      quick,
      true,
    );
    await surface();
    const panel = await screen.findByRole('group', { name: 'List' });
    expect(within(panel).getByLabelText('Kind')).toBeDisabled();

    const formatting = within(screen.getByRole('toolbar', { name: 'Formatting' })).getAllByRole(
      'button',
    )[0]!;
    formatting.focus();
    await userEvent.keyboard('{F6}');

    expect(panel).toHaveFocus();
  });
});

describe('quotations and preformatted text on the surface (editor 5)', () => {
  const openWith = (stored: unknown) =>
    open(
      {
        'GET /v1/components/{id}': () => json(200, opened({ content: stored })),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        ...saves,
      },
      quick,
      true,
    );

  /** The content of every iteration the session has sent, oldest first. */
  const sent = (asked: { route: string; body: unknown }[]) =>
    asked
      .filter((each) => each.route.startsWith('PUT /v1/components/{id}/iterations/'))
      .map((each) => (each.body as { content: { content: unknown[] } }).content.content);

  const REFUSED_SAVE = 'This text cannot be saved as it stands';

  const typeText = (view: EditorView, text: string) =>
    act(() => view.dispatch(view.state.tr.insertText(text)));
  const key = (view: EditorView, name: 'Tab' | 'Enter') =>
    act(() => {
      fireEvent.keyDown(view.dom, { key: name, keyCode: name === 'Tab' ? 9 : 13 });
    });

  it('CNT-018 an author makes preformatted text, types indentation, a tab and a blank line, labels it sql, and the iteration sent holds all of it byte for byte', async () => {
    const { asked, surface } = openWith(blocksOf(para('b1', 'x')));
    const view = await surface();
    caretIn(view, 'b1');
    act(() => view.dispatch(view.state.tr.delete(1, 2)));

    await userEvent.click(await screen.findByRole('button', { name: 'Preformatted text' }));
    typeText(view, '  a');
    key(view, 'Tab');
    typeText(view, 'b');
    key(view, 'Enter');
    key(view, 'Enter');
    typeText(view, 'c');
    const label = await screen.findByLabelText('Language label');
    await userEvent.type(label, 'sql{Enter}');

    await waitFor(() =>
      expect(sent(asked).at(-1)).toEqual([
        {
          type: 'preformatted',
          id: expect.any(String),
          text: '  a\u{9}b\u{A}\u{A}c',
          language: 'sql',
        },
      ]),
    );
    expect(screen.queryByText(REFUSED_SAVE, { exact: false })).toBeNull();
  });

  it('sends a quotation made from the toolbar with the attribution typed, and with none while it is empty', async () => {
    const { asked, surface } = openWith(blocksOf(para('b1', 'Words.')));
    const view = await surface();
    caretIn(view, 'b1');

    await userEvent.click(await screen.findByRole('button', { name: 'Quotation' }));
    await waitFor(() =>
      expect(sent(asked).at(-1)).toEqual([
        {
          type: 'blockquote',
          id: expect.any(String),
          content: [expect.objectContaining({ id: 'b1' })],
        },
      ]),
    );

    let attribution = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'attribution') attribution = pos + 1;
    });
    act(() => view.dispatch(view.state.tr.insertText('Ada', attribution)));
    await waitFor(() =>
      expect(sent(asked).at(-1)).toEqual([
        expect.objectContaining({
          type: 'blockquote',
          attribution: [{ type: 'text', value: 'Ada', marks: [] }],
        }),
      ]),
    );
    expect(screen.queryByText(REFUSED_SAVE, { exact: false })).toBeNull();
  });

  it('offers both on the toolbar with their shortcuts said, and Preformatted text over a bold paragraph', async () => {
    const bold = {
      type: 'paragraph',
      id: 'b1',
      style: 'body',
      content: [{ type: 'text', value: 'Bold', marks: [{ type: 'strong', id: 'm1' }] }],
    };
    const { surface } = openWith(blocksOf(bold));
    const view = await surface();
    caretIn(view, 'b1');
    const quotation = await screen.findByRole('button', { name: 'Quotation' });
    const code = screen.getByRole('button', { name: 'Preformatted text' });
    expect(quotation).toHaveAttribute('title', 'Quotation (Ctrl or Cmd, Shift and full stop)');
    expect(code).toHaveAttribute('title', 'Preformatted text (Ctrl or Cmd, Shift and comma)');
    // Offered, and the marks dropped when pressed (Ken, at plan review; decision K).
    expect(code).toHaveAttribute('aria-disabled', 'false');
  });

  it('shows the preformatted panel only in a preformatted block, reachable by F6, refusing a label that is not a token', async () => {
    const pre = { type: 'preformatted', id: 'p1', text: 'select 1', language: 'sql' };
    const { surface } = openWith(blocksOf(para('b1', 'Before.'), pre));
    const view = await surface();
    caretIn(view, 'b1');
    expect(screen.queryByRole('group', { name: 'Preformatted text' })).toBeNull();

    caretIn(view, 'p1');
    const panel = await screen.findByRole('group', { name: 'Preformatted text' });
    const label = within(panel).getByLabelText('Language label');
    expect(label).toHaveValue('sql');

    // F6 from the surface goes round the ring and reaches the panel.
    view.focus();
    await userEvent.keyboard('{Shift>}{F6}{/Shift}');
    expect(panel.contains(document.activeElement) || document.activeElement === panel).toBe(true);

    await userEvent.clear(label);
    await userEvent.type(label, 'a b{Enter}');
    expect(
      await within(panel).findByText(
        'A language label is letters, digits and + # . _ - only, up to 32 characters.',
      ),
    ).toBeInTheDocument();
    expect(label).toHaveAttribute('aria-invalid', 'true');
    expect(fromEditor(view.state.doc).content[1]).toMatchObject({ language: 'sql' });

    await userEvent.clear(label);
    await userEvent.type(label, '{Enter}');
    await waitFor(() =>
      expect(fromEditor(view.state.doc).content[1]).not.toHaveProperty('language'),
    );
  });
});

describe('the table panel (tables 1)', () => {
  const openWith = (stored: unknown) =>
    open(
      {
        'GET /v1/components/{id}': () => json(200, opened({ content: stored })),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        ...saves,
      },
      quick,
      true,
    );

  const cellOf = (id: string, value: string) => ({
    content: [
      { type: 'paragraph', id, style: 'body', content: [{ type: 'text', value, marks: [] }] },
    ],
    colspan: 1,
    rowspan: 1,
  });
  /** One header row over one row of data, two columns. */
  const aTable = blocksOf(para('b1', 'Before.'), {
    type: 'table',
    id: 't1',
    style: 'table',
    caption: [{ type: 'text', value: 'Readings', marks: [] }],
    headerRows: 1,
    headerColumns: 0,
    rows: [
      { cells: [cellOf('h1', 'Site'), cellOf('h2', 'Value')] },
      { cells: [cellOf('d1', 'York'), cellOf('d2', '1')] },
    ],
  });
  const tableOf = (view: EditorView) =>
    fromEditor(view.state.doc).content.find((block) => block.type === 'table') as
      { headerRows: number; headerColumns: number; rows: { cells: unknown[] }[] } | undefined;
  const caretIn = (view: EditorView, id: string) =>
    act(() =>
      view.dispatch(
        view.state.tr.setSelection(Selection.near(view.state.doc.resolve(inside(view, id)))),
      ),
    );

  it('inserts a table from the toolbar, and shows its panel only while the cursor is in one', async () => {
    const { surface } = openWith(content('Unbox the printer.'));
    const view = await surface();
    expect(screen.queryByRole('group', { name: 'Table' })).toBeNull();
    selectText(view, 19, 19);
    await userEvent.click(screen.getByRole('button', { name: 'Table' }));

    const panel = await screen.findByRole('group', { name: 'Table' });
    expect(within(panel).getByLabelText('Header rows')).toHaveValue(1);
    expect(within(panel).getByLabelText('Header columns')).toHaveValue(0);
    expect(tableOf(view)).toMatchObject({ headerRows: 1, headerColumns: 0 });
    expect(tableOf(view)!.rows).toHaveLength(3);

    caretIn(view, fromEditor(view.state.doc).content[0]!.id);
    expect(screen.queryByRole('group', { name: 'Table' })).toBeNull();
  });

  it('sets header rows and columns, and adds and deletes rows and columns', async () => {
    const { surface } = openWith(aTable);
    const view = await surface();
    caretIn(view, 'd1');
    const panel = await screen.findByRole('group', { name: 'Table' });

    fireEvent.change(within(panel).getByLabelText('Header columns'), { target: { value: '1' } });
    await waitFor(() => expect(tableOf(view)).toMatchObject({ headerRows: 1, headerColumns: 1 }));

    await userEvent.click(within(panel).getByRole('button', { name: 'Row below' }));
    expect(tableOf(view)!.rows).toHaveLength(3);
    await userEvent.click(within(panel).getByRole('button', { name: 'Delete column' }));
    expect(tableOf(view)!.rows[0]!.cells).toHaveLength(1);
  });

  it('says a button is unavailable where pressing it would do nothing', async () => {
    const { surface } = openWith(aTable);
    const view = await surface();
    caretIn(view, 'd1');
    const panel = await screen.findByRole('group', { name: 'Table' });
    // Nothing is merged and no cells are selected, so neither has anything to act on.
    expect(within(panel).getByRole('button', { name: 'Merge cells' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(within(panel).getByRole('button', { name: 'Split cell' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(within(panel).getByRole('button', { name: 'Row below' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    const before = view.state.doc;
    await userEvent.click(within(panel).getByRole('button', { name: 'Merge cells' }));
    expect(view.state.doc.eq(before)).toBe(true);
  });

  it('deletes the table, caption and all', async () => {
    const { surface } = openWith(aTable);
    const view = await surface();
    caretIn(view, 'd2');
    const panel = await screen.findByRole('group', { name: 'Table' });
    await userEvent.click(within(panel).getByRole('button', { name: 'Delete table' }));
    expect(tableOf(view)).toBeUndefined();
    expect(screen.queryByRole('group', { name: 'Table' })).toBeNull();
  });

  it('is a region F6 reaches while the cursor is in a table', async () => {
    const { surface } = openWith(aTable);
    const view = await surface();
    caretIn(view, 'd1');
    const panel = await screen.findByRole('group', { name: 'Table' });
    view.focus();
    await userEvent.keyboard('{Shift>}{F6}{/Shift}');
    expect(within(panel).getByLabelText('Header rows')).toHaveFocus();
  });
});
