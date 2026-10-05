import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlatformBridge } from '../platform/bridge.js';
import { shimRangeMeasurement } from '../test/range.js';
import {
  open,
  content,
  opened,
  lock,
  json,
  quick,
  runs,
  languageField,
  directionField,
  runsOf,
  selectRange,
} from './test/componentEditor.js';

shimRangeMeasurement();

afterEach(() => vi.restoreAllMocks());

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

describe("the spelling checker's languages (W14.7)", () => {
  // Every change saves as the author goes; enough answered that no test runs out of them.
  const everySave = Object.fromEntries(
    Array.from({ length: 16 }, (_, at) => [
      `PUT /v1/components/{id}/iterations/{session}/${at + 1}`,
      () => json(200, { sequence: at + 1, lock }),
    ]),
  );
  /** A desktop's bridge, which records each list of languages it is asked to set. */
  const recording = () => {
    const asked: string[][] = [];
    const bridge: PlatformBridge = {
      getPlatformInfo: async () => ({ delivery: 'desktop', runtime: 'Electron 44.3.0' }),
      setSpellCheckLanguages: async (languages) => {
        asked.push([...languages]);
      },
    };
    return { bridge, asked };
  };

  it("CNT-178 keeps the browser's checker on the surface, and asks the desktop's for the component's base language on opening and as it changes", async () => {
    const { bridge, asked } = recording();
    const { surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        ...everySave,
      },
      quick,
      // In StrictMode, as the application runs it. That a list already asked for is not asked
      // again, however often the editor mounts, is spelling.test.ts's to show, not this test's.
      true,
      { bridge },
    );
    await surface();
    // The browser's own checker marks the surface, in the component's language.
    const box = screen.getByRole('textbox', { name: 'Content of Install the printer' });
    expect(box).toHaveAttribute('spellcheck', 'true');
    expect(box).toHaveAttribute('lang', 'en-GB');
    // And the desktop's is told which dictionary to check it against.
    await waitFor(() => expect(asked).toEqual([['en-GB']]));

    fireEvent.change(await languageField(), { target: { value: 'fr-CA' } });
    await waitFor(() => expect(asked).toEqual([['en-GB'], ['fr-CA']]));
    expect(box).toHaveAttribute('lang', 'fr-CA');
  });

  it('asks for no language it cannot hold, while the author is still typing one', async () => {
    const { bridge, asked } = recording();
    const { surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        ...everySave,
      },
      quick,
      false,
      { bridge },
    );
    await surface();
    await waitFor(() => expect(asked).toEqual([['en-GB']]));
    // Half a tag is refused by the header and never reaches the component, nor the bridge.
    fireEvent.change(await languageField(), { target: { value: 'fr-' } });
    fireEvent.change(await languageField(), { target: { value: 'de-DE' } });
    await waitFor(() => expect(asked).toEqual([['en-GB'], ['de-DE']]));
  });

  it("lets go of the component's language as it closes", async () => {
    const { bridge, asked } = recording();
    const first = open({ 'GET /v1/components/{id}': () => json(200, opened()) }, quick, false, {
      bridge,
    });
    await first.surface();
    await waitFor(() => expect(asked).toEqual([['en-GB']]));
    cleanup();
    // Nothing is left open, so nothing more is asked: the dictionaries stay as they were.
    expect(asked).toEqual([['en-GB']]);
    // And a component opened next is checked in its own language alone.
    const german = { ...content('Den Drucker auspacken.'), language: 'de-DE' };
    const next = open(
      { 'GET /v1/components/{id}': () => json(200, opened({ content: german })) },
      quick,
      false,
      { bridge },
    );
    await next.surface();
    await waitFor(() => expect(asked).toEqual([['en-GB'], ['de-DE']]));
  });
});
