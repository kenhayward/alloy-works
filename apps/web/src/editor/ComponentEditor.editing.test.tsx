import { createApiClient } from '@alloy-works/api-client';
import { bindingDigestInput, DEFAULT_CATALOGUES, type Binding } from '@alloy-works/domain';
import { fromEditor, NodeSelection, Selection, type EditorView } from '@alloy-works/editor';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shimRangeMeasurement } from '../test/range.js';
import { StatusProvider } from '../shell/Status.js';
import { ComponentEditor } from './ComponentEditor.js';
import { designTiming } from './session.js';
import { ZoomControl } from '../theme/Canvas.js';
import { PresentationProvider } from '../theme/presentation.js';
import {
  CHOOSING_PRESENTATION,
  DEFAULT_PRESENTATION,
  presentationWith,
} from '../theme/presentation.fixture.js';
import {
  open,
  COMPONENT,
  SESSION,
  ADA,
  content,
  opened,
  lock,
  json,
  type Answer,
  service,
  quick,
  GRACE_EDITING,
  pasteEvent,
  selectText,
  languageField,
  directionField,
} from './test/componentEditor.js';

shimRangeMeasurement();

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

  it('keeps its fields beside the surface, and saves what is typed into them with the content', async () => {
    const { asked, surface } = open({
      'GET /v1/components/{id}': () =>
        json(
          200,
          opened({
            type: { id: 'type-protocol', name: 'Protocol' },
            fields: [
              {
                id: 'field-code',
                name: 'Code',
                dataType: 'text',
                multiplicity: 'one',
                validation: { maxLength: 4 },
                required: true,
                requiredBy: ['schema-review'],
                fixed: false,
                fixedBy: [],
              },
            ],
            schemas: [{ id: 'schema-review', name: 'Review' }],
            values: {},
          }),
        ),
      'GET /v1/people': () => json(200, { items: [{ id: ADA, name: 'Ada' }], next: null }),
      'POST /v1/components/{id}/lock': () => json(200, { lock }),
      'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
    });
    const view = await surface();
    const fields = screen.getByRole('region', { name: 'Fields of Protocol' });
    const code = within(fields).getByRole('textbox', { name: /^Code/ });
    expect(code).toHaveAccessibleDescription(/Code is required/);
    await userEvent.type(code, 'A1');
    await waitFor(() =>
      expect(asked.find((each) => each.route.startsWith('PUT'))?.body).toMatchObject({
        openedFrom: 'v1',
        values: { 'field-code': 'A1' },
      }),
    );
    // A region of the view: F6 from the surface lands on its first field.
    view.focus();
    await userEvent.keyboard('{F6}');
    expect(document.activeElement).toBe(code);
  });

  it('puts its fields back, as it puts the text back, when the claim a change made is refused', async () => {
    const { surface } = open({
      'GET /v1/components/{id}': () =>
        json(
          200,
          opened({
            type: { id: 'type-protocol', name: 'Protocol' },
            fields: [
              {
                id: 'field-code',
                name: 'Code',
                dataType: 'text',
                multiplicity: 'one',
                validation: {},
                required: false,
                requiredBy: [],
                fixed: false,
                fixedBy: [],
              },
            ],
            schemas: [],
            values: { 'field-code': 'A1' },
          }),
        ),
      'POST /v1/components/{id}/lock': () =>
        json(409, {
          code: 'lock_held',
          message: 'held',
          traceId: 't',
          holder: { id: 'grace', name: 'Grace' },
          expectedRelease: '2026-09-16T09:15:00.000Z',
        }),
    });
    await surface();
    const code = within(screen.getByRole('region', { name: 'Fields of Protocol' })).getByRole(
      'textbox',
      { name: /^Code/ },
    );
    await userEvent.type(code, '9');
    // Grace holds it: what was typed is not the component's, in its fields as in its text.
    await screen.findByRole('button', { name: 'Try again' });
    // The form is drawn afresh, so the field is asked for again.
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Fields of Protocol' })).getByRole('textbox', {
          name: /^Code/,
        }),
      ).toHaveValue('A1'),
    );
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

  it('CNT-173 shows characters outside the Basic Multilingual Plane, and saves one typed among them whole', async () => {
    // Mathematical bold capital A and a grinning face: each two UTF-16 units, one character.
    const held = 'Mass \u{1d400} and \u{1f600}.';
    const { asked, surface } = open({
      'GET /v1/components/{id}': () => json(200, opened({ content: content(held) })),
      'POST /v1/components/{id}/lock': () => json(200, { lock }),
      'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
    });
    const view = await surface();
    // Shown on the surface as stored.
    expect(view.dom.textContent).toBe(held);

    // A Linear B syllable typed between the two, just after the capital: its position is counted in
    // UTF-16 units, as ProseMirror counts, so the capital's two units are both passed.
    view.dispatch(view.state.tr.insertText(' \u{10000}', 1 + 'Mass \u{1d400}'.length));
    await waitFor(() =>
      expect(asked.map((each) => each.route)).toContain(
        'PUT /v1/components/{id}/iterations/{session}/1',
      ),
    );
    const saved = asked.find((each) => each.route.startsWith('PUT'))!.body as {
      content: ReturnType<typeof content>;
    };
    expect(saved.content).toEqual(content('Mass \u{1d400} \u{10000} and \u{1f600}.'));
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

    expect(await screen.findByText(GRACE_EDITING)).toBeInTheDocument();
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
    // A citation: every block is carried since equations 1, and this is about content the editor
    // still has no node for.
    const withCitation = content('Before');
    withCitation.content.push({
      type: 'paragraph',
      id: 't1',
      style: 'body',
      content: [{ type: 'citation', entry: 'ada-1843' }],
    } as never);
    open({ 'GET /v1/components/{id}': () => json(200, opened({ content: withCitation })) });
    expect(
      await screen.findByText(
        'This component holds content this editor cannot change yet (citation), so it is shown for reading only.',
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
    // The save is held unanswered until the test lets it go (issue #386). Answered at once, the whole
    // cycle - dirty, claimed, sent, saved - can finish inside one task on a slow runner, before React
    // has committed any of it, and then the guard, which follows what was committed, never goes on at
    // all: a wait for it waits for something that is never coming.
    let answerSave: (response: Response) => void = () => undefined;
    const save = new Promise<Response>((resolve) => (answerSave = resolve));
    const { surface } = open({
      'GET /v1/components/{id}': () => json(200, opened()),
      'POST /v1/components/{id}/lock': () => json(200, { lock }),
      'PUT /v1/components/{id}/iterations/{session}/1': () => save,
    });
    const view = await surface();
    const closing = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(closing()).toBe(false);

    view.dispatch(view.state.tr.insertText(' Keep the box.', 19));
    // A real close, not a captured handler: the guard must be registered with `window` now.
    await waitFor(() => expect(closing()).toBe(true));

    answerSave(json(200, { sequence: 1, lock }));
    await screen.findByTitle(/^Saved at/);
    await waitFor(() => expect(closing()).toBe(false));
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
    expect(screen.getByText(GRACE_EDITING)).toBeInTheDocument();

    view.dispatch(view.state.tr.insertText(' Keep the box.', 19));
    await waitFor(() => expect(screen.queryByText(GRACE_EDITING)).toBeNull());
    await userEvent.click(await screen.findByRole('button', { name: 'Done editing' }));
    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: 'Content of Install the printer' }),
      ).toHaveAttribute('contenteditable', 'true'),
    );
    // The stale GET-time lock said Grace held it; this author has since claimed and released it
    // themselves, so the notice must not reappear from that stale snapshot (fix round 1 minor).
    expect(screen.queryByText(GRACE_EDITING)).toBeNull();
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

  it('CNT-169 undo reaches back past neither the version opened nor a version cut in the session', async () => {
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
    // `Mod-z` through the key handlers the view's state was built with, as a real keydown reaches it.
    const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform);
    const undo = () =>
      view.someProp('handleKeyDown', (handle) =>
        handle(view, {
          key: 'z',
          keyCode: 90,
          ctrlKey: !mac,
          metaKey: mac,
          altKey: false,
          shiftKey: false,
        } as never),
      ) ?? false;

    // The version the session opened from: there is nothing before it to go back to - and undo is
    // there, taking back what is typed as far as the version and no further.
    const openedWith = view.state.doc.textContent;
    expect(undo()).toBe(false);
    view.dispatch(view.state.tr.insertText(' Mind the cable.', 19));
    expect(view.state.doc.textContent).not.toBe(openedWith);
    expect(undo()).toBe(true);
    expect(view.state.doc.textContent).toBe(openedWith);
    expect(undo()).toBe(false);
    expect(view.state.doc.textContent).toBe(openedWith);

    view.dispatch(view.state.tr.insertText(' Keep the box.', 19));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save version' })).not.toBeDisabled(),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save version' }));
    await screen.findByText('Version 0.2 saved.');

    // The version cut: what it holds stays, however often undo is pressed; what is typed after it
    // undoes back to it, and no further.
    const cut = view.state.doc.textContent;
    expect(cut).toContain('Keep the box.');
    expect(undo()).toBe(false);
    expect(view.state.doc.textContent).toBe(cut);
    view.dispatch(view.state.tr.insertText(' Then wait.', view.state.doc.content.size - 1));
    expect(view.state.doc.textContent).not.toBe(cut);
    expect(undo()).toBe(true);
    expect(view.state.doc.textContent).toBe(cut);
    expect(undo()).toBe(false);
    expect(view.state.doc.textContent).toBe(cut);
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

describe('the component editor opened at a place', () => {
  const equation = {
    type: 'equation',
    id: 'e1',
    mathml:
      '<math xmlns="http://www.w3.org/1998/Math/MathML" alttext="x squared"><msup><mi>x</mi><mn>2</mn></msup></math>',
    numbered: false,
  };
  const three = opened({
    content: {
      ...content('Unbox the printer.', 'Plug it in.'),
      content: [...content('Unbox the printer.', 'Plug it in.').content, equation],
    },
  });

  it('SCH-057 opens at the block a link names, and says so by name when it is no longer there', async () => {
    const linked = open({ 'GET /v1/components/{id}': () => json(200, three) }, quick, false, {
      linked: { block: 'b2', arrival: 1 },
    });
    const view = await linked.surface();
    // The caret stands in the block the link names, and the surface has the focus.
    expect(view.state.selection.$from.parent.attrs['id']).toBe('b2');
    expect(view.hasFocus()).toBe(true);
    cleanup();

    const gone = open({ 'GET /v1/components/{id}': () => json(200, three) }, quick, false, {
      linked: { block: 'b9', arrival: 1 },
    });
    await gone.surface();
    // Its newest version is what opened, and the page says the place is no longer in it.
    expect(
      await screen.findByText(
        'The part the link names is no longer in this component. This is its latest version.',
      ),
    ).toBeInTheDocument();
  });

  it('selects a block with nothing to type into, rather than the block after it', async () => {
    const linked = open({ 'GET /v1/components/{id}': () => json(200, three) }, quick, false, {
      linked: { block: 'e1', arrival: 1 },
    });
    const view = await linked.surface();
    const selection = view.state.selection as NodeSelection;
    expect(selection.node?.attrs['id']).toBe('e1');
  });

  it('goes to each place a link names in turn, the component staying open between them', async () => {
    const { client } = service({ 'GET /v1/components/{id}': () => json(200, three) });
    let view: EditorView | undefined;
    const at = (block: string, arrival: number) => (
      <ComponentEditor
        componentId={COMPONENT}
        client={client}
        principalId={ADA}
        sessionId={SESSION}
        timing={quick}
        onView={(mounted) => (view = mounted)}
        linked={{ block, arrival }}
      />
    );
    const { rerender } = render(at('b2', 1));
    await screen.findByLabelText('Title');
    await waitFor(() => expect(view?.state.selection.$from.parent.attrs['id']).toBe('b2'));
    const first = view;
    rerender(at('b1', 2));
    await waitFor(() => expect(view?.state.selection.$from.parent.attrs['id']).toBe('b1'));
    // The same surface, moved: nothing was opened again.
    expect(view).toBe(first);
  });
});

describe('the surface set in the theme\'s type, at the layout\'s measure (themes.md, "The theme in the editor")', () => {
  /** A component holding running text and a quotation, opened inside the environment's presentation. */
  async function openInTheme() {
    const quoted = {
      ...content('Unbox the printer.'),
      content: [
        ...content('Unbox the printer.').content,
        {
          type: 'blockquote',
          id: 'q1',
          content: [
            {
              type: 'paragraph',
              id: 'b2',
              style: 'body',
              content: [{ type: 'text', value: 'Keep the box.', marks: [] }],
            },
          ],
        },
      ],
    };
    const { client } = service({
      'GET /v1/components/{id}': () => json(200, opened({ content: quoted })),
      'GET /v1/presentation': () => json(200, DEFAULT_PRESENTATION),
    });
    let view: EditorView | undefined;
    render(
      <PresentationProvider client={client}>
        <ZoomControl />
        <ComponentEditor
          componentId={COMPONENT}
          client={client}
          principalId={ADA}
          sessionId={SESSION}
          timing={quick}
          onView={(mounted) => (view = mounted)}
        />
      </PresentationProvider>,
    );
    await screen.findByRole('textbox', { name: 'Content of Install the printer' });
    await screen.findByLabelText('Title');
    // The theme arrives beside the component, and the text is set in it once it has.
    await waitFor(() => expect(document.querySelector('.aw-canvas')).not.toBeNull());
    const paragraph = (text: string) =>
      [...view!.dom.querySelectorAll('p')].find((each) => each.textContent === text)!;
    return { view: view!, paragraph };
  }

  afterEach(() => {
    try {
      window.localStorage.clear();
    } catch {
      // Storage refused: nothing was kept.
    }
  });

  it("CNT-097 sets the surface's text in the theme's own face, loaded from the renderer, at the size the theme declares", async () => {
    const { paragraph } = await openInTheme();
    const running = getComputedStyle(paragraph('Unbox the printer.'));
    expect(running.fontFamily).toBe('"aw-face-serif"');
    expect(running.fontSize).toBe('calc(11pt * var(--aw-zoom))');
    // The face it names is declared from the pinned file, never a face of that name on the machine.
    expect(document.querySelector('style[data-aw-faces]')?.textContent).toContain(
      '@font-face { font-family: "aw-face-serif"',
    );
  });

  it("CNT-082 separates the surface's blocks by the theme's spacing, a paragraph in a quotation by the quotation's", async () => {
    const { paragraph } = await openInTheme();
    // The body: nothing before, 2.75pt after, added to the next block's space before - each a length
    // the stylesheet names once, which jsdom gives back as written, without its spaces.
    const body = getComputedStyle(paragraph('Unbox the printer.'));
    expect(body.getPropertyValue('--aw-before').trim()).toBe('calc(0pt*var(--aw-zoom))');
    expect(body.getPropertyValue('--aw-after').trim()).toBe('calc(2.75pt*var(--aw-zoom))');
    // A stored body in a quotation is the quotation's default: 16.5pt before, 12.65pt after, and set
    // in from both sides by 11pt.
    const quoted = getComputedStyle(paragraph('Keep the box.'));
    expect(quoted.getPropertyValue('--aw-before').trim()).toBe('calc(16.5pt*var(--aw-zoom))');
    expect(quoted.getPropertyValue('--aw-after').trim()).toBe('calc(12.65pt*var(--aw-zoom))');
    expect(quoted.getPropertyValue('margin-inline')).toBe(
      'calc(11pt * var(--aw-zoom)) calc(11pt * var(--aw-zoom))',
    );
  });

  it("CNT-115 sets the surface at the layout's measure, scaled by the zoom a reader chooses and keeps", async () => {
    const { view } = await openInTheme();
    const canvas = view.dom.closest('.aw-canvas') as HTMLElement;
    expect(canvas.style.getPropertyValue('--aw-measure')).toBe('451.28pt');
    expect(canvas.style.getPropertyValue('--aw-zoom')).toBe('1');
    expect(getComputedStyle(view.dom).width).toBe('calc(var(--aw-measure) * var(--aw-zoom))');

    await userEvent.selectOptions(screen.getByLabelText('Zoom'), '150%');
    expect(canvas.style.getPropertyValue('--aw-zoom')).toBe('1.5');
    // Kept for this reader: the next page opened is at the same zoom.
    cleanup();
    const again = await openInTheme();
    expect(
      (again.view.dom.closest('.aw-canvas') as HTMLElement).style.getPropertyValue('--aw-zoom'),
    ).toBe('1.5');
    expect(screen.getByLabelText('Zoom')).toHaveValue('1.5');
  });

  it("CNT-122 sizes a figure and an image in a line by their image styles, from the image's own pixels, as a publish does", async () => {
    const ASSET = '00000000-0000-4000-8000-0000000000a1';
    const stored = {
      ...content('Unbox the printer.'),
      content: [
        {
          type: 'paragraph',
          id: 'b1',
          style: 'body',
          content: [
            { type: 'text', value: 'Press ', marks: [] },
            {
              type: 'image',
              asset: ASSET,
              imageStyle: 'inline',
              alternative: { kind: 'decorative' },
            },
          ],
        },
        {
          type: 'figure',
          id: 'f1',
          asset: ASSET,
          imageStyle: 'figure',
          caption: [{ type: 'text', value: 'The tray', marks: [] }],
          alternative: { kind: 'decorative' },
        },
        {
          type: 'table',
          id: 't1',
          style: 'table',
          caption: [{ type: 'text', value: 'Readings', marks: [] }],
          headerRows: 1,
          headerColumns: 0,
          rows: [
            {
              cells: [
                {
                  content: [
                    {
                      type: 'paragraph',
                      id: 'c1',
                      style: 'body',
                      content: [{ type: 'text', value: 'Tray', marks: [] }],
                    },
                  ],
                  colspan: 1,
                  rowspan: 1,
                },
              ],
            },
          ],
        },
      ],
    };
    const { client } = service({
      'GET /v1/components/{id}': () => json(200, opened({ content: stored })),
      'GET /v1/presentation': () => json(200, DEFAULT_PRESENTATION),
      [`GET /v1/asset-versions/${ASSET}`]: () =>
        json(200, {
          id: ASSET,
          asset: 'a1',
          number: '0.1',
          format: 'png',
          bytes: 11,
          width: 1200,
          height: 800,
          resolution: null,
          alternative: null,
        }),
    });
    let view: EditorView | undefined;
    render(
      <PresentationProvider client={client}>
        <ComponentEditor
          componentId={COMPONENT}
          client={client}
          principalId={ADA}
          sessionId={SESSION}
          timing={quick}
          onView={(mounted) => (view = mounted)}
        />
      </PresentationProvider>,
    );
    await screen.findByLabelText('Title');
    const figure = () => view!.dom.querySelector('figure[data-figure] img') as HTMLImageElement;
    const inline = () => view!.dom.querySelector('img.aw-inline-image') as HTMLImageElement;
    // The figure: the measure wide, since 800 / 1200 of it is less than 0.6 of the text block high.
    await waitFor(() => expect(figure().style.width).toBe('calc(451.28pt * var(--aw-zoom))'));
    // The image in a line: 1.2 ems of the body's 11pt high, and wide in proportion: 19.8pt.
    await waitFor(() => expect(inline().style.width).toBe('calc(19.8pt * var(--aw-zoom))'));
    // And the table in its table style: its cells ruled at 1pt in black, as the default's are, half of
    // each rule drawn by each cell beside its line.
    const cell = getComputedStyle(
      view!.dom.querySelector('figure[data-table-style="table"] th') as HTMLElement,
    );
    expect(cell.getPropertyValue('--aw-rule-top').trim()).toBe('calc(0.5pt*var(--aw-zoom))');
    expect(cell.getPropertyValue('--aw-rule-top-colour').trim()).toBe('#000000');
  });

  it("STY-079 stands a table's caption and a figure's on the side their styles place them - a table's below its cells and before its note, a figure's above its image - and leaves the default's where the markup has them", async () => {
    const ASSET = '00000000-0000-4000-8000-0000000000a1';
    const [table] = DEFAULT_CATALOGUES.table.styles;
    const [figure] = DEFAULT_CATALOGUES.image.styles;
    const captioned = (id: string, style: string) => ({
      type: 'table',
      id,
      style,
      caption: [{ type: 'text', value: `Readings ${id}`, marks: [] }],
      headerRows: 0,
      headerColumns: 0,
      note: [{ type: 'text', value: `Noted ${id}`, marks: [] }],
      rows: [
        {
          cells: [
            {
              content: [
                {
                  type: 'paragraph',
                  id: `${id}c1`,
                  style: 'body',
                  content: [{ type: 'text', value: 'Tray', marks: [] }],
                },
              ],
              colspan: 1,
              rowspan: 1,
            },
          ],
        },
      ],
    });
    const pictured = (id: string, imageStyle: string) => ({
      type: 'figure',
      id,
      asset: ASSET,
      imageStyle,
      caption: [{ type: 'text', value: `The tray ${id}`, marks: [] }],
      alternative: { kind: 'decorative' },
    });
    const stored = {
      ...content('Unbox the printer.'),
      content: [
        captioned('t1', 'table'),
        captioned('t2', 'footed'),
        pictured('f1', 'figure'),
        pictured('f2', 'headed'),
      ],
    };
    const { client } = service({
      'GET /v1/components/{id}': () => json(200, opened({ content: stored })),
      'GET /v1/presentation': () =>
        json(
          200,
          presentationWith({
            table: [{ ...table, id: 'footed', name: 'Footed', caption: 'below' }],
            image: [{ ...figure, id: 'headed', name: 'Headed', caption: 'above' }],
          }),
        ),
      [`GET /v1/asset-versions/${ASSET}`]: () =>
        json(200, {
          id: ASSET,
          asset: 'a1',
          number: '0.1',
          format: 'png',
          bytes: 11,
          width: 1200,
          height: 800,
          resolution: null,
          alternative: null,
        }),
    });
    let view: EditorView | undefined;
    render(
      <PresentationProvider client={client}>
        <ComponentEditor
          componentId={COMPONENT}
          client={client}
          principalId={ADA}
          sessionId={SESSION}
          timing={quick}
          onView={(mounted) => (view = mounted)}
        />
      </PresentationProvider>,
    );
    await screen.findByLabelText('Title');
    const at = (selector: string) => view!.dom.querySelector(selector) as HTMLElement;
    const declared = (selector: string, property: string) =>
      getComputedStyle(at(selector)).getPropertyValue(property);
    // The styles reach the surface once the theme has: wait for a rule the theme writes.
    await waitFor(() =>
      expect(declared('figure[data-table-style="footed"]', 'display')).toBe('flex'),
    );
    // Below its cells, the note after it: the table's parts stacked, the caption ordered after them.
    expect(declared('figure[data-table-style="footed"]', 'flex-direction')).toBe('column');
    expect(declared('figure[data-table-style="footed"] > .aw-table-caption', 'order')).toBe('1');
    expect(declared('figure[data-table-style="footed"] > .aw-table-note', 'order')).toBe('2');
    // Above its image: the caption's body ordered before the image.
    expect(declared('figure[data-image-style="headed"]', 'display')).toBe('flex');
    expect(declared('figure[data-image-style="headed"] > .aw-figure-body', 'order')).toBe('-1');
    // The default's: a table's caption first in its markup and a figure's last, where each stands.
    expect(declared('figure[data-table-style="table"]', 'display')).not.toBe('flex');
    expect(declared('figure[data-table-style="table"] > .aw-table-caption', 'order')).toBe('0');
    expect(declared('figure[data-image-style="figure"]', 'display')).not.toBe('flex');
    expect(declared('figure[data-image-style="figure"] > .aw-figure-body', 'order')).toBe('0');
    // And the caption is still the caption, in the markup the stored table and figure are read from.
    expect(at('figure[data-table-style="footed"]').firstElementChild).toHaveClass(
      'aw-table-caption',
    );
  });

  it('STY-070 marks a style, a typeface or a character that will not resolve, rather than setting it in a silent default', async () => {
    const stored = {
      ...content('Unbox the printer.'),
      content: [
        {
          type: 'paragraph',
          id: 'b1',
          style: 'gone',
          content: [{ type: 'text', value: 'Keep the receipt.', marks: [] }],
        },
        {
          type: 'blockquote',
          id: 'q1',
          content: [
            {
              type: 'paragraph',
              id: 'b2',
              style: 'lead',
              content: [{ type: 'text', value: 'Keep the box.', marks: [] }],
            },
          ],
        },
        {
          type: 'paragraph',
          id: 'b3',
          style: 'body',
          content: [{ type: 'text', value: 'Letter ا here.', marks: [] }],
        },
      ],
    };
    // A theme whose monospaced face names a file the renderer does not hold.
    const unheldMono = {
      ...DEFAULT_PRESENTATION,
      theme: {
        ...DEFAULT_PRESENTATION.theme,
        content: {
          ...DEFAULT_PRESENTATION.theme.content,
          typefaces: DEFAULT_PRESENTATION.theme.content.typefaces.map((typeface) =>
            typeface.id === 'mono'
              ? {
                  ...typeface,
                  files: typeface.files.map((file, index) =>
                    index === 0 ? { ...file, sha256: '0'.repeat(64) } : file,
                  ),
                }
              : typeface,
          ),
        },
      },
    };
    const { client } = service({
      'GET /v1/components/{id}': () => json(200, opened({ content: stored })),
      'GET /v1/presentation': () => json(200, unheldMono),
    });
    let view: EditorView | undefined;
    render(
      <PresentationProvider client={client}>
        <ComponentEditor
          componentId={COMPONENT}
          client={client}
          principalId={ADA}
          sessionId={SESSION}
          timing={quick}
          onView={(mounted) => (view = mounted)}
        />
      </PresentationProvider>,
    );
    await screen.findByLabelText('Title');
    const paragraph = (text: string) =>
      [...view!.dom.querySelectorAll('p')].find((each) => each.textContent === text)!;

    // A style the theme does not hold: marked, named, and set meanwhile in the default where it stands.
    await waitFor(() =>
      expect(paragraph('Keep the receipt.')).toHaveAttribute('data-unresolved', 'missing'),
    );
    expect(paragraph('Keep the receipt.')).toHaveAttribute(
      'data-unresolved-label',
      'Style gone is not in this theme',
    );
    expect(getComputedStyle(paragraph('Keep the receipt.')).fontSize).toBe(
      'calc(11pt * var(--aw-zoom))',
    );
    // One it holds for running text, standing in a quotation: marked, and set as the quotation's.
    expect(paragraph('Keep the box.')).toHaveAttribute('data-unresolved', 'misplaced');
    expect(getComputedStyle(paragraph('Keep the box.')).getPropertyValue('margin-inline')).toBe(
      'calc(11pt * var(--aw-zoom)) calc(11pt * var(--aw-zoom))',
    );
    // A character no face of the family setting it holds: marked, its code point named.
    const glyph = view!.dom.querySelector('.aw-glyph-missing');
    expect(glyph?.textContent).toBe('ا');
    expect(glyph).toHaveAttribute('title', 'No glyph for U+0627 in this typeface');
    // A face the renderer does not hold: said, by its family, where the text stands.
    expect(await screen.findByText(/Liberation Mono/)).toBeInTheDocument();
  });

  it('leaves the text as it was where no presentation arrives', async () => {
    const { client } = service({ 'GET /v1/components/{id}': () => json(200, opened()) });
    let view: EditorView | undefined;
    render(
      <PresentationProvider client={client}>
        <ComponentEditor
          componentId={COMPONENT}
          client={client}
          principalId={ADA}
          sessionId={SESSION}
          timing={quick}
          onView={(mounted) => (view = mounted)}
        />
      </PresentationProvider>,
    );
    await screen.findByLabelText('Title');
    expect(view!.dom.closest('.aw-canvas')).toBeNull();
  });
});

describe("choosing a block's style from the theme's catalogues (themes.md, ET-G)", () => {
  const saves = Object.fromEntries(
    Array.from({ length: 64 }, (_, at) => [
      `PUT /v1/components/{id}/iterations/{session}/${at + 1}`,
      () => json(200, { sequence: at + 1, lock }),
    ]),
  );
  const withQuotationAndTable = {
    ...content('Unbox the printer.'),
    content: [
      ...content('Unbox the printer.').content,
      {
        type: 'blockquote',
        id: 'q1',
        content: [
          {
            type: 'paragraph',
            id: 'b2',
            style: 'body',
            content: [{ type: 'text', value: 'Keep the box.', marks: [] }],
          },
        ],
      },
      {
        type: 'table',
        id: 't1',
        style: 'table',
        caption: [{ type: 'text', value: 'Readings', marks: [] }],
        headerRows: 0,
        headerColumns: 0,
        rows: [
          {
            cells: [
              {
                content: [
                  {
                    type: 'paragraph',
                    id: 'c1',
                    style: 'body',
                    content: [{ type: 'text', value: 'Tray', marks: [] }],
                  },
                ],
                colspan: 1,
                rowspan: 1,
              },
            ],
          },
        ],
      },
    ],
  };
  const openChoosing = (presentation: unknown = CHOOSING_PRESENTATION) =>
    open(
      {
        'GET /v1/components/{id}': () => json(200, opened({ content: withQuotationAndTable })),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        ...saves,
      },
      quick,
      true,
      {},
      presentation,
    );
  /** The caret just inside the text block reading `text`. */
  const caretIn = (view: EditorView, text: string) =>
    act(() => {
      let at = -1;
      view.state.doc.descendants((node, pos) => {
        if (at === -1 && node.isTextblock && node.textContent === text) at = pos + 1;
        return at === -1;
      });
      view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(at))));
    });
  const optionsOf = (list: HTMLElement) =>
    [...(list as HTMLSelectElement).options].map((option) => option.text);

  it("offers the environment's default theme's own styles to choose: Lead, Centred and Small print for running text, and Banded for a table", async () => {
    const { surface } = openChoosing(DEFAULT_PRESENTATION);
    const view = await surface();
    caretIn(view, 'Unbox the printer.');
    expect(optionsOf(await screen.findByLabelText('Paragraph style'))).toEqual([
      'Body (default)',
      'Lead',
      'Centred',
      'Small print',
    ]);
    caretIn(view, 'Tray');
    const panel = await screen.findByRole('group', { name: 'Table' });
    expect(optionsOf(within(panel).getByLabelText('Table style'))).toEqual(['Table', 'Banded']);
  });

  it("CNT-094 sets a paragraph's appearance only by a named style from the theme's catalogue, offering those that apply where it stands", async () => {
    const { surface } = openChoosing();
    const view = await surface();
    caretIn(view, 'Unbox the printer.');
    const list = await screen.findByLabelText('Paragraph style');
    // Running text: its default, and the styles for running text. Not the quotation's, and never a
    // heading or a caption, which the template sets by role.
    expect(optionsOf(list)).toEqual(['Body (default)', 'Lead', 'Centred', 'Small print', 'Plain']);
    await userEvent.selectOptions(list, 'Lead');
    await waitFor(() =>
      expect(view.dom.querySelector('p[data-style="lead"]')?.textContent).toBe(
        'Unbox the printer.',
      ),
    );
    expect(fromEditor(view.state.doc).content[0]).toMatchObject({ style: 'lead' });

    // In a quotation: the quotation's default, and a quotation's style.
    caretIn(view, 'Keep the box.');
    await waitFor(() =>
      expect(optionsOf(screen.getByLabelText('Paragraph style'))).toEqual([
        'Quotation (default)',
        'Plain',
        'Pull quote',
      ]),
    );
    expect(screen.getByLabelText('Paragraph style')).toHaveValue('body');
  });

  it('offers across paragraphs in different places only the styles that apply in all of them, and sets them all', async () => {
    const { surface } = openChoosing();
    const view = await surface();
    // From the running text into the quotation.
    act(() => {
      const spans: number[] = [];
      view.state.doc.descendants((node, pos) => {
        if (
          node.isTextblock &&
          ['Unbox the printer.', 'Keep the box.'].includes(node.textContent)
        ) {
          spans.push(pos + 2);
        }
      });
      view.dispatch(
        view.state.tr.setSelection(
          Selection.fromJSON(view.state.doc, { type: 'text', anchor: spans[0], head: spans[1] }),
        ),
      );
    });
    const list = await screen.findByLabelText('Paragraph style');
    // No one default names both, and only Plain applies in both.
    expect(optionsOf(list)).toEqual(['Default', 'Plain']);
    await userEvent.selectOptions(list, 'Plain');
    await waitFor(() => expect(view.dom.querySelectorAll('p[data-style="plain"]')).toHaveLength(2));
  });

  it("chooses a footnote's paragraph style in the footnote's own editor, from the styles a footnote takes", async () => {
    const { surface } = openChoosing();
    const view = await surface();
    act(() => {
      let at = -1;
      view.state.doc.descendants((node, pos) => {
        if (at === -1 && node.isTextblock && node.textContent === 'Unbox the printer.') {
          at = pos + 1 + node.content.size;
        }
        return at === -1;
      });
      view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(at))));
    });
    await userEvent.click(screen.getByRole('button', { name: 'Footnote' }));
    await screen.findByRole('textbox', { name: 'Footnote text' });
    const list = await screen.findByLabelText('Paragraph style');
    expect(optionsOf(list)).toEqual(['Footnote (default)', 'Small note']);
    await userEvent.selectOptions(list, 'Small note');
    await waitFor(() =>
      expect(JSON.stringify(fromEditor(view.state.doc).content[0])).toContain(
        '"style":"small-note"',
      ),
    );
  });

  it("chooses a table's style in the Table panel, from the table catalogue", async () => {
    const { surface } = openChoosing();
    const view = await surface();
    caretIn(view, 'Tray');
    const panel = await screen.findByRole('group', { name: 'Table' });
    const list = within(panel).getByLabelText('Table style');
    expect(optionsOf(list)).toEqual(['Table', 'Banded']);
    expect(list).toHaveValue('table');
    await userEvent.selectOptions(list, 'Banded');
    await waitFor(() =>
      expect(view.dom.querySelector('figure[data-table-style="banded"]')).not.toBeNull(),
    );
  });
});

describe('a binding in the editor (the B1 plan, task 5)', () => {
  const READINGS = 'abcdef01-0000-4000-8000-000000000001';
  const HIDDEN_DEFINITION = 'abcdef01-0000-4000-8000-000000000009';
  const decimal = { base: 'decimal', precision: 10, scale: 1 } as const;
  const bound = (id: string, query = READINGS) => ({
    type: 'binding',
    id,
    query,
    parameters: { site: { literal: '1' } },
    mode: 'checked',
    take: { column: 'depth' },
  });
  const holding = (...inlines: unknown[]) => ({
    ...content('x'),
    content: [
      {
        type: 'paragraph',
        id: 'p1',
        style: 'body',
        content: [{ type: 'text', value: 'The mean was ', marks: [] }, ...inlines],
      },
    ],
  });
  /** What each binding on the surface shows a sighted reader, in document order. */
  const shownOn = (view: EditorView) =>
    [...view.dom.querySelectorAll('[data-binding]')].map((each) => {
      const copy = each.cloneNode(true) as Element;
      copy.querySelectorAll('.aw-binding-hidden').forEach((hidden) => hidden.remove());
      return copy.textContent;
    });
  /** The position of the n-th binding in the surface's document. */
  const bindingAt = (view: EditorView, n = 0) => {
    const at: number[] = [];
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'binding') at.push(pos);
    });
    return at[n]!;
  };
  /** As the document page tells an editor opened in place what it holds for `b1`. */
  const inDocument = (): Partial<React.ComponentProps<typeof ComponentEditor>> => ({
    bindingContext: {
      kind: 'document',
      node: 'nnnnnnnnnnnnnnnnnnnnnnnnnn',
      held: new Map([
        [
          'b1',
          {
            binding: bindingDigestInput(bound('b1') as Binding),
            shown: { value: '1,234.5', waiting: false },
          },
        ],
      ]),
    },
    bindingStates: new Map([
      [
        'b1',
        {
          node: 'nnnnnnnnnnnnnnnnnnnnnnnnnn',
          binding: bound('b1') as Binding,
          held: {
            dataset: 'd',
            version: 'v',
            number: '0.1',
            provenance: {
              parameters: { site: '1' },
              sql: null,
              identity: 'service',
              at: '2026-10-04T09:30:00.000Z',
              rowCount: 1,
              checksum: '0'.repeat(64),
            },
            name: null,
            stale: false,
            taken: { value: '1234.5', column: { name: 'depth', type: decimal } },
            act: 'resolve',
            keepable: false,
            by: { id: ADA, displayName: 'Ada' },
            at: '2026-10-04T09:31:00.000Z',
          },
          waiting: null,
          definition: { title: 'Readings', version: '0.2' },
          connection: null,
          definitionChanged: false,
          sincePublished: null,
          mayCheck: true,
          mayResolve: true,
        },
      ],
    ]),
  });

  it("shows a binding on the component's own page as what it asks for, by its definition's title, and never a value", async () => {
    const { surface, asked } = open({
      'GET /v1/components/{id}': () =>
        json(
          200,
          opened({
            content: holding(bound('b1'), bound('b3'), bound('b2', HIDDEN_DEFINITION)),
          }),
        ),
      [`GET /v1/query-definitions/${READINGS}`]: () =>
        json(200, { id: READINGS, definition: { title: 'Readings' } }),
    });
    const view = await surface();
    await waitFor(() =>
      expect(shownOn(view)).toEqual(['depth, Readings', 'depth, Readings', 'a bound value']),
    );
    // Each definition asked for once, whatever the bindings naming it: two name Readings.
    expect(
      asked
        .filter((each) => each.route.startsWith('GET /v1/query-definitions/'))
        .map((each) => each.route)
        .sort(),
    ).toEqual([
      `GET /v1/query-definitions/${READINGS}`,
      `GET /v1/query-definitions/${HIDDEN_DEFINITION}`,
    ]);
    expect(asked.some((each) => each.route.includes('/bindings'))).toBe(false);
  });

  it('shows the Value panel for a binding selected whole, and opens its provenance from it', async () => {
    const provenance = vi.fn();
    const { surface } = open(
      { 'GET /v1/components/{id}': () => json(200, opened({ content: holding(bound('b1')) })) },
      quick,
      false,
      { ...inDocument(), onProvenance: provenance },
    );
    const view = await surface();
    await waitFor(() => expect(shownOn(view)).toEqual(['1,234.5']));
    expect(screen.queryByRole('region', { name: 'Value' })).toBeNull();
    act(() =>
      view.dispatch(
        view.state.tr.setSelection(NodeSelection.create(view.state.doc, bindingAt(view))),
      ),
    );
    const panel = await screen.findByRole('region', { name: 'Value' });
    expect(panel).toHaveTextContent('1,234.5');
    expect(panel).toHaveTextContent('Query definition: Readings, version 0.2');
    expect(panel).toHaveTextContent('Mode: Checked');
    expect(panel).toHaveTextContent('Fetched 4 October 2026');
    const button = within(panel).getByRole('button', { name: 'Provenance' });
    await userEvent.click(button);
    expect(provenance).toHaveBeenCalledWith('b1', button);
    // The button is what opened it, wherever the focus was: the page gives the focus back to it.
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    fireEvent.click(button);
    expect(provenance).toHaveBeenLastCalledWith('b1', button);
  });

  it("says nothing of a binding's definition on its own page while its title is still being asked for", async () => {
    let answer: (response: Response) => void = () => undefined;
    const { surface } = open({
      'GET /v1/components/{id}': () => json(200, opened({ content: holding(bound('b1')) })),
      [`GET /v1/query-definitions/${READINGS}`]: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    const view = await surface();
    act(() =>
      view.dispatch(
        view.state.tr.setSelection(NodeSelection.create(view.state.doc, bindingAt(view))),
      ),
    );
    const panel = await screen.findByRole('region', { name: 'Value' });
    expect(panel).not.toHaveTextContent('Query definition');
    answer(json(200, { id: READINGS, definition: { title: 'Readings' } }));
    await waitFor(() => expect(panel).toHaveTextContent('Query definition: Readings'));
  });

  it('pastes a copy of a binding as one never resolved, and says so in the paste report', async () => {
    const { surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened({ content: holding(bound('b1')) })),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
      },
      quick,
      false,
      inDocument(),
    );
    const view = await surface();
    const at = bindingAt(view);
    act(() => view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at))));
    const written = new Map<string, string>();
    const copy = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(copy, 'clipboardData', {
      value: {
        clearData: () => written.clear(),
        setData: (type: string, value: string) => written.set(type, value),
      },
    });
    view.dom.dispatchEvent(copy);
    // Another application is given what it shows.
    expect(written.get('text/plain')).toBe('1,234.5');
    selectText(view, at + 1, at + 1);
    view.dom.dispatchEvent(pasteEvent(Object.fromEntries(written)));
    await waitFor(() => expect(shownOn(view)).toEqual(['1,234.5', 'No value - never resolved']));
    const report = await screen.findByRole('region', { name: 'Paste report' });
    expect(report).toHaveTextContent(
      'Bound values were copied, each to be resolved in a document before it shows a value.',
    );
  });

  /** The definition the Value dialog offers, at its latest version: a site's depth by its id. */
  const definitionRoutes = (): Record<string, Answer> => ({
    'GET /v1/query-definitions': () =>
      json(200, {
        items: [
          {
            id: READINGS,
            title: 'Readings',
            space: { id: 's', name: 'General' },
            connection: { id: 'c', name: null, identity: 'service' },
            retired: false,
            version: { id: 'v', number: '0.2' },
            changedAt: '2026-10-05T09:00:00.000Z',
          },
        ],
        next: null,
        total: 1,
        facets: { spaces: [] },
      }),
    [`GET /v1/query-definitions/${READINGS}`]: () =>
      json(200, {
        id: READINGS,
        version: { id: 'abcdef01-0000-4000-8000-0000000000a2', number: '0.2' },
        definition: {
          title: 'Readings',
          parameters: [{ name: 'site', type: { base: 'integer' }, required: true, list: false }],
          columns: [{ name: 'depth', from: { column: 'depth' }, type: decimal }],
          key: [],
        },
        connection: { id: 'c', name: null, identity: 'service' },
        mayUse: true,
      }),
  });

  it('places a binding from the Value dialog in a document, and tells the document once its session has saved it', async () => {
    const onSettle = vi.fn();
    const { surface, asked } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened({ content: holding() })),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
        ...definitionRoutes(),
      },
      quick,
      false,
      { ...inDocument(), bindingActs: { pinned: false, onSettle } },
    );
    const view = await surface();
    selectText(view, 4, 4);
    await userEvent.click(screen.getByRole('button', { name: 'Value' }));
    const dialog = await screen.findByRole('dialog', { name: 'Value' });
    await userEvent.click(await within(dialog).findByRole('radio', { name: /Readings/ }));
    await userEvent.type(await within(dialog).findByLabelText('site'), '1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Insert' }));
    await waitFor(() => expect(onSettle).toHaveBeenCalledTimes(1));
    const placed = asked.find((each) => each.route.startsWith('PUT'))!.body;
    expect(JSON.stringify(placed)).toContain('"type":"binding"');
    expect(onSettle).toHaveBeenCalledWith(expect.any(String), SESSION, 'placed');
    expect(screen.queryByRole('dialog', { name: 'Value' })).toBeNull();
  });

  it('offers Change in the Value panel, and Keep where what it holds may be kept, Resolve otherwise', async () => {
    const onSettle = vi.fn();
    const document = inDocument();
    const keepable = new Map(
      [...document.bindingStates!].map(([id, state]) => [
        id,
        { ...state, held: { ...state.held!, stale: true, keepable: true } },
      ]),
    );
    const { surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened({ content: holding(bound('b1')) })),
        ...definitionRoutes(),
      },
      quick,
      false,
      { ...document, bindingStates: keepable, bindingActs: { pinned: false, onSettle } },
    );
    const view = await surface();
    act(() =>
      view.dispatch(
        view.state.tr.setSelection(NodeSelection.create(view.state.doc, bindingAt(view))),
      ),
    );
    const panel = await screen.findByRole('region', { name: 'Value' });
    expect(within(panel).queryByRole('button', { name: 'Resolve' })).toBeNull();
    await userEvent.click(within(panel).getByRole('button', { name: 'Keep' }));
    // Nothing typed: the page holds no session, and the binding is read from the version.
    await waitFor(() => expect(onSettle).toHaveBeenCalledWith('b1', null, 'keep'));
    await userEvent.click(within(panel).getByRole('button', { name: 'Change' }));
    const dialog = await screen.findByRole('dialog', { name: 'Value' });
    expect(await within(dialog).findByRole('button', { name: 'Change' })).toBeInTheDocument();
  });

  /** The definitions the Value dialog offers, Readings with an image column as well (B6-H). */
  const withPhoto = (): Record<string, Answer> => ({
    ...definitionRoutes(),
    [`GET /v1/query-definitions/${READINGS}`]: () =>
      json(200, {
        id: READINGS,
        version: { id: 'abcdef01-0000-4000-8000-0000000000a2', number: '0.2' },
        definition: {
          title: 'Readings',
          parameters: [{ name: 'site', type: { base: 'integer' }, required: true, list: false }],
          columns: [
            { name: 'depth', from: { column: 'depth' }, type: decimal },
            {
              name: 'photo',
              from: { column: 'photo' },
              type: { base: 'image', encoding: 'binary', description: { column: 'name' } },
            },
          ],
          key: [],
        },
        connection: { id: 'c', name: null, identity: 'service' },
        mayUse: true,
      }),
  });

  it('DAT-098 places an image column from the Value dialog as a figure, and tells the document once its session has saved it', async () => {
    const onSettle = vi.fn();
    const { surface, asked } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened({ content: holding() })),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
        ...withPhoto(),
      },
      quick,
      false,
      { ...inDocument(), bindingActs: { pinned: false, onSettle } },
    );
    const view = await surface();
    selectText(view, 4, 4);
    await userEvent.click(screen.getByRole('button', { name: 'Value' }));
    const dialog = await screen.findByRole('dialog', { name: 'Value' });
    await userEvent.click(await within(dialog).findByRole('radio', { name: /Readings/ }));
    await userEvent.type(await within(dialog).findByLabelText('site'), '1');
    await userEvent.selectOptions(within(dialog).getByLabelText('Column'), 'photo');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'As a figure' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Insert' }));
    await waitFor(() => expect(onSettle).toHaveBeenCalledTimes(1));
    const placed = JSON.stringify(asked.find((each) => each.route.startsWith('PUT'))!.body);
    const figure = /"type":"figure"[^]*?"binding":\{"type":"binding","id":"([^"]+)"/.exec(placed);
    expect(figure).not.toBeNull();
    expect(placed).toContain('"take":{"column":"photo"}');
    expect(onSettle).toHaveBeenCalledWith(figure![1], SESSION, 'placed');
    // The cursor in its caption, its panel shows its binding.
    expect(await screen.findByRole('region', { name: 'Value' })).toBeInTheDocument();
  });

  it("shows a bound figure's binding in the Value panel beside the Figure panel, and Change opens the dialog on it offering image columns alone", async () => {
    const figureContent = {
      ...content('x'),
      content: [
        {
          type: 'figure',
          id: 'f1',
          binding: { ...bound('b1'), take: { column: 'photo' } },
          imageStyle: 'figure',
          caption: [{ type: 'text', value: 'The gate', marks: [] }],
          alternative: { kind: 'inherited' },
        },
      ],
    };
    const { surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened({ content: figureContent })),
        ...withPhoto(),
      },
      quick,
      false,
      { ...inDocument(), bindingContext: { kind: 'document', held: new Map() } },
    );
    const view = await surface();
    // Into its caption.
    selectText(view, 3, 3);
    const panel = await screen.findByRole('region', { name: 'Value' });
    expect(panel).toHaveTextContent('No value - never resolved');
    const figurePanel = screen.getByRole('group', { name: 'Figure' });
    expect(figurePanel).toHaveTextContent('Use the description its data gives');
    expect(within(figurePanel).queryByRole('radio', { name: 'Describe it here' })).toBeNull();
    await userEvent.click(within(panel).getByRole('button', { name: 'Change' }));
    const dialog = await screen.findByRole('dialog', { name: 'Value' });
    const column = await within(dialog).findByLabelText('Column');
    expect([...(column as HTMLSelectElement).options].map((each) => each.value)).toEqual([
      'photo',
    ]);
  });
});
