import {
  fromEditor,
  NodeSelection,
  openFootnote,
  Selection,
  setListAttributes,
  type EditorView,
} from '@alloy-works/editor';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RegionKeys } from '../shell/regions.js';
import { shimRangeMeasurement } from '../test/range.js';
import { CHOOSING_PRESENTATION } from '../theme/presentation.fixture.js';
import {
  open,
  content,
  para,
  opened,
  lock,
  json,
  type Answer,
  quick,
  inside,
  pasteEvent,
  selectText,
  saves,
  shown,
  caretIn,
  blocksOf,
  listOf,
  aListAndAParagraph,
} from './test/componentEditor.js';

shimRangeMeasurement();

afterEach(() => vi.restoreAllMocks());

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

  it("sets a list's options on the toolbar's second line: Nest and Lift for any list, Start at and Numbering for a numbered one alone, and no Kind, which the toolbar's buttons are (ADR-0053)", async () => {
    const { surface } = openTwoParagraphs();
    const view = await surface();
    await screen.findByRole('button', { name: 'Bulleted list' });
    const formatting = screen.getByRole('toolbar', { name: 'Formatting' });
    // The line is there before anything is chosen, so nothing below it moves as options come and go.
    const line = formatting.nextElementSibling as HTMLElement;
    expect(line).toHaveAttribute('data-toolbar-line');
    expect(screen.queryByRole('group', { name: 'List' })).toBeNull();
    // Nest and Lift are a list's own, and stand with its options rather than on the first line.
    expect(within(formatting).queryByRole('button', { name: 'Nest item' })).toBeNull();
    expect(within(formatting).queryByRole('button', { name: 'Lift item' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Bulleted list' }));
    const panel = await within(line).findByRole('group', { name: 'List' });
    expect(within(panel).queryByLabelText('Kind')).toBeNull();
    // A bulleted list's options are its own: none of a numbered list's.
    expect(within(panel).queryByLabelText('Start at')).toBeNull();
    expect(within(panel).queryByLabelText('Numbering')).toBeNull();
    expect(within(panel).getByRole('button', { name: 'Nest item' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Lift item' })).toBeInTheDocument();

    // The toolbar's Numbered list makes it a numbered one, and its options follow.
    await userEvent.click(screen.getByRole('button', { name: 'Numbered list' }));
    const numbering = await within(line).findByLabelText('Numbering');
    await userEvent.selectOptions(
      numbering,
      within(numbering).getByRole('option', { name: 'a, b, c' }),
    );
    expect(screen.getByText('The number the first item takes')).toBeInTheDocument();
    await userEvent.type(within(line).getByLabelText('Start at'), '5');

    await waitFor(() =>
      expect(firstBlock(view)).toMatchObject({
        type: 'list',
        kind: 'ordered',
        start: 5,
        format: 'alphabetic',
      }),
    );

    // The options go as the cursor leaves the list; the line they stood on stays.
    act(() =>
      view.dispatch(
        view.state.tr.setSelection(Selection.near(view.state.doc.resolve(inside(view, 'b2')))),
      ),
    );
    expect(screen.queryByRole('group', { name: 'List' })).toBeNull();
    expect(line.isConnected).toBe(true);
  });

  it("nests an item from the toolbar's second line, and lifts it back", async () => {
    const { surface } = openWith(
      blocksOf(listOf('L1', 'unordered', {}, para('b1', 'Unbox it.'), para('b2', 'Plug it in.'))),
    );
    const view = await surface();
    caretIn(view, 'b2');
    const panel = await screen.findByRole('group', { name: 'List' });
    await userEvent.click(within(panel).getByRole('button', { name: 'Nest item' }));
    await waitFor(() =>
      expect(firstBlock(view)).toMatchObject({
        items: [
          { content: [{ id: 'b1' }, { type: 'list', items: [{ content: [{ id: 'b2' }] }] }] },
        ],
      }),
    );
    await userEvent.click(within(panel).getByRole('button', { name: 'Lift item' }));
    await waitFor(() =>
      expect(firstBlock(view)).toMatchObject({
        items: [{ content: [{ id: 'b1' }] }, { content: [{ id: 'b2' }] }],
      }),
    );
  });

  it('offers a definition list Nest and Lift alone, having no start and no numbering to set', async () => {
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
    const panel = screen.getByRole('group', { name: 'List' });
    expect(
      within(panel)
        .getAllByRole('button')
        .map((each) => each.getAttribute('aria-label')),
    ).toEqual(['Nest item', 'Lift item']);
    expect(within(panel).queryByLabelText('Start at')).toBeNull();
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
    expect(within(panel).getByRole('button', { name: 'Nest item' })).toHaveFocus();
    await userEvent.keyboard('{F6}');
    expect(text).toHaveFocus();
    await userEvent.keyboard('{F6}');
    expect(title).toHaveFocus();

    await userEvent.keyboard('{Shift>}{F6}{/Shift}');
    expect(text).toHaveFocus();
    await userEvent.keyboard('{Shift>}{F6}{/Shift}');
    expect(within(panel).getByRole('button', { name: 'Nest item' })).toHaveFocus();

    // Save version and Done editing are not a region: they keep their own ordinary tab stops, and
    // F6 pressed from them enters the ring at its first region rather than cycling out of them.
    // They take the focus only once a change has claimed the lock, which the press above did.
    const save = await screen.findByRole('button', { name: 'Save version' });
    await waitFor(() => expect(save).toBeEnabled());
    // One tab stop for them all, the arrows moving along it, as every toolbar is (LG6b).
    expect(
      within(screen.getByRole('toolbar', { name: 'Component' }))
        .getAllByRole('button')
        .filter((button) => button.tabIndex === 0),
    ).toHaveLength(1);

    save.focus();
    await userEvent.keyboard('{F6}');
    expect(title).toHaveFocus();
  });

  it("CNT-077 hands F6 on to the application's own regions past either end of its ring, where it stands in one", async () => {
    const { surface } = open({ 'GET /v1/components/{id}': () => json(200, opened()) }, quick);
    await surface();
    const { title, text } = landings();
    // The application around it: the header band before it, and the page it stands in.
    const band = document.createElement('header');
    band.setAttribute('data-app-region', '');
    band.innerHTML = '<a href="#/">Alloy Works</a>';
    document.body.prepend(band);
    screen.getByRole('article').parentElement!.setAttribute('data-app-region', '');
    render(<RegionKeys />);

    text.focus();
    await userEvent.keyboard('{F6}');
    expect(screen.getByRole('link', { name: 'Alloy Works' })).toHaveFocus();
    await userEvent.keyboard('{F6}');
    expect(screen.getByRole('group', { name: 'Component header' })).toHaveFocus();

    title.focus();
    await userEvent.keyboard('{Shift>}{F6}{/Shift}');
    expect(screen.getByRole('link', { name: 'Alloy Works' })).toHaveFocus();
    band.remove();
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
    expect(within(panel).getByRole('button', { name: 'Nest item' })).toBeDisabled();

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
    // On the toolbar's second line (ADR-0053), not a band of its own over the text.
    expect(panel.closest('[data-toolbar-line]')).not.toBeNull();
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

  it('STR-071 marks the table unnumbered from its Numbered box, and numbered again, its caption kept', async () => {
    const { surface } = openWith(aTable);
    const view = await surface();
    caretIn(view, 'd1');
    const panel = await screen.findByRole('group', { name: 'Table' });
    const box = within(panel).getByRole('checkbox', { name: 'Numbered' });
    expect(box).toBeChecked();
    expect(tableOf(view)).not.toHaveProperty('numbered');

    await userEvent.click(box);
    await waitFor(() => expect(tableOf(view)).toMatchObject({ numbered: false }));
    expect(within(panel).getByRole('checkbox', { name: 'Numbered' })).not.toBeChecked();
    expect(tableOf(view)).toMatchObject({
      caption: [{ type: 'text', value: 'Readings', marks: [] }],
    });

    await userEvent.click(within(panel).getByRole('checkbox', { name: 'Numbered' }));
    await waitFor(() => expect(tableOf(view)).not.toHaveProperty('numbered'));
  });

  it("sets Wide from the Table panel: the style's, Scale or Rotate (TB3.3)", async () => {
    const { surface } = openWith(aTable);
    const view = await surface();
    caretIn(view, 'd1');
    const panel = await screen.findByRole('group', { name: 'Table' });
    const wide = within(panel).getByLabelText('Wide');
    expect(wide).toHaveDisplayValue("The table style's");
    await userEvent.selectOptions(wide, 'scale');
    await waitFor(() => expect(tableOf(view)).toMatchObject({ wide: 'scale' }));
    await userEvent.selectOptions(within(panel).getByLabelText('Wide'), 'style');
    await waitFor(() => expect(tableOf(view)).not.toHaveProperty('wide'));
  });

  it('shows a table stored unnumbered as unnumbered, and follows an undo', async () => {
    const { surface } = openWith(
      blocksOf(para('b1', 'Before.'), {
        ...(aTable.content as { type: string }[]).find((block) => block.type === 'table'),
        numbered: false,
      }),
    );
    const view = await surface();
    caretIn(view, 'd1');
    const panel = await screen.findByRole('group', { name: 'Table' });
    expect(within(panel).getByRole('checkbox', { name: 'Numbered' })).not.toBeChecked();
    await userEvent.click(within(panel).getByRole('checkbox', { name: 'Numbered' }));
    await waitFor(() =>
      expect(within(panel).getByRole('checkbox', { name: 'Numbered' })).toBeChecked(),
    );
    act(() => {
      fireEvent.keyDown(view.dom, { key: 'z', ctrlKey: true });
    });
    await waitFor(() =>
      expect(within(panel).getByRole('checkbox', { name: 'Numbered' })).not.toBeChecked(),
    );
  });
});

describe('a figure in the editor (figures 2)', () => {
  const UPLOAD = '7a0c1b8e-6f3e-4d2a-9d36-2a4f1c9e7b10';
  const RED = '00000000-0000-4000-8000-00000000a551';
  const BLUE = '00000000-0000-4000-8000-00000000b10e';
  const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const uploadView = (state: string, extra: Record<string, unknown> = {}) => ({
    id: UPLOAD,
    space: 's1',
    state,
    reason: null,
    assetVersion: null,
    ...extra,
  });
  /** The asset routes, answering an upload that is made, filled and ready as this version. */
  const uploads = (version: string, filled: Answer = () => json(200, uploadView('checking'))) => ({
    'POST /v1/spaces/s1/asset-uploads': () => json(200, uploadView('awaiting')),
    [`PUT /v1/asset-uploads/${UPLOAD}/bytes`]: filled,
    [`GET /v1/asset-uploads/${UPLOAD}`]: () =>
      json(200, uploadView('ready', { assetVersion: version })),
  });
  const assetVersion = (id: string, alternative: unknown) => ({
    [`GET /v1/asset-versions/${id}`]: () =>
      json(200, {
        id,
        asset: 'a1',
        number: '0.1',
        format: 'png',
        bytes: 11,
        width: 4,
        height: 3,
        resolution: null,
        alternative,
      }),
  });
  // Every iteration a test here can make: typing into the panel saves as the author goes, and a slower
  // machine batches fewer keystrokes into each save, so eight ran out on CI - the ninth answered 404,
  // the session stopped, and the last letters typed were refused as read-only.
  const everySave = Object.fromEntries(
    Array.from({ length: 64 }, (_, at) => [
      `PUT /v1/components/{id}/iterations/{session}/${at + 1}`,
      () => json(200, { sequence: at + 1, lock }),
    ]),
  );
  const openWith = (stored: unknown, extra: Record<string, Answer> = {}, presentation?: unknown) =>
    open(
      {
        'GET /v1/components/{id}': () => json(200, opened({ content: stored })),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        ...everySave,
        ...extra,
      },
      quick,
      true,
      {},
      presentation,
    );
  const figureOf = (view: EditorView) =>
    fromEditor(view.state.doc).content.find((block) => block.type === 'figure') as
      { id: string; asset: string; imageStyle: string; alternative: unknown } | undefined;
  const aFigure = (alternative: unknown) =>
    blocksOf(para('b1', 'Before.'), {
      type: 'figure',
      id: 'f1',
      asset: RED,
      imageStyle: 'figure',
      caption: [{ type: 'text', value: 'Shapes', marks: [] }],
      alternative,
    });
  /** The caret into the caption of the figure counted from the first, the first unless said. */
  const caretInCaption = (view: EditorView, which = 0) =>
    act(() => {
      let at = -1;
      let seen = 0;
      view.state.doc.descendants((node, pos) => {
        if (at === -1 && node.type.name === 'figureCaption' && seen++ === which) at = pos + 1;
        return at === -1;
      });
      view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(at))));
    });
  const chooseImage = async (dialog: HTMLElement) =>
    userEvent.upload(
      within(dialog).getByLabelText('Image'),
      new File([pngBytes], 'shapes.png', { type: 'image/png' }),
    );
  /** Figure settings opened from a panel (ADR-0055): the dialog every alternative is chosen in. */
  const settingsOf = async (panel: HTMLElement, named = 'Figure settings') => {
    await userEvent.click(within(panel).getByRole('button', { name: named }));
    return screen.findByRole('dialog', { name: named });
  };

  it("CNT-121 gives a figure the image style chosen from the image catalogue, placing it and in its panel, offering only a figure's", async () => {
    // Placed: the dialog offers the figure styles of the environment's theme, and places it in the one chosen.
    const { surface } = openWith(
      content('Unbox the printer.'),
      { ...uploads(RED), ...assetVersion(RED, null) },
      CHOOSING_PRESENTATION,
    );
    const view = await surface();
    selectText(view, 19, 19);
    await userEvent.click(screen.getByRole('button', { name: 'Figure' }));
    const dialog = await screen.findByRole('dialog', { name: 'Figure' });
    const offered = await within(dialog).findByLabelText('Image style');
    expect([...(offered as HTMLSelectElement).options].map((option) => option.text)).toEqual([
      'Figure',
      'Half width',
    ]);
    await userEvent.selectOptions(offered, 'Half width');
    await chooseImage(dialog);
    await userEvent.click(within(dialog).getByLabelText('It is decorative'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    await waitFor(() =>
      expect(figureOf(view)).toMatchObject({ asset: RED, imageStyle: 'half-width' }),
    );

    // Changed: the panel offers the same, and sets the one chosen.
    caretInCaption(view);
    const panel = await screen.findByRole('group', { name: 'Figure' });
    // On the toolbar's second line (ADR-0053), not a band of its own over the text.
    expect(panel.closest('[data-toolbar-line]')).not.toBeNull();
    const list = within(panel).getByLabelText('Image style') as HTMLSelectElement;
    expect(list).toHaveValue('half-width');
    expect([...list.options].map((option) => option.text)).toEqual(['Figure', 'Half width']);
    await userEvent.selectOptions(list, 'Figure');
    await waitFor(() => expect(figureOf(view)).toMatchObject({ imageStyle: 'figure' }));

    // And Figure settings offers it too, set as the line set it (ADR-0055).
    const settings = await settingsOf(panel);
    const there = within(settings).getByLabelText('Image style') as HTMLSelectElement;
    expect(there).toHaveValue('figure');
    await userEvent.selectOptions(there, 'Half width');
    await waitFor(() => expect(figureOf(view)).toMatchObject({ imageStyle: 'half-width' }));
  });

  it('CNT-121 gives an image in a line the image style chosen from the image catalogue, placing it and in its panel', async () => {
    const { surface } = openWith(
      content('Unbox the printer.'),
      { ...uploads(RED), ...assetVersion(RED, null) },
      CHOOSING_PRESENTATION,
    );
    const view = await surface();
    selectText(view, 19, 19);
    await userEvent.click(screen.getByRole('button', { name: 'Image' }));
    const dialog = await screen.findByRole('dialog', { name: 'Image' });
    const offered = await within(dialog).findByLabelText('Image style');
    // An image in a line's styles, never a figure's.
    expect([...(offered as HTMLSelectElement).options].map((option) => option.text)).toEqual([
      'Inline image',
      'Icon',
    ]);
    await userEvent.selectOptions(offered, 'Icon');
    await chooseImage(dialog);
    await userEvent.click(within(dialog).getByLabelText('It is decorative'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    const stored = () => JSON.stringify(fromEditor(view.state.doc).content);
    await waitFor(() => expect(stored()).toContain('"imageStyle":"icon"'));

    // Selected whole, the image's panel offers the same, and sets the one chosen.
    act(() => {
      let at = -1;
      view.state.doc.descendants((node, pos) => {
        if (at === -1 && node.type.name === 'image') at = pos;
        return at === -1;
      });
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at)));
    });
    const panel = await screen.findByRole('group', { name: 'Image' });
    // On the toolbar's second line (ADR-0053), not a band of its own over the text.
    expect(panel.closest('[data-toolbar-line]')).not.toBeNull();
    const list = within(panel).getByLabelText('Image style');
    expect(list).toHaveValue('icon');
    await userEvent.selectOptions(list, 'Inline image');
    await waitFor(() => expect(stored()).toContain('"imageStyle":"inline"'));
  });

  it("AST-039 makes a figure from an image described in the language the author chose, and gives it its own text in the component's", async () => {
    const { asked, surface } = openWith(content('Unbox the printer.'), {
      ...uploads(RED),
      ...assetVersion(RED, { text: 'Zwei Formen', language: 'de' }),
    });
    const view = await surface();
    selectText(view, 19, 19);
    await userEvent.click(screen.getByRole('button', { name: 'Figure' }));
    const dialog = await screen.findByRole('dialog', { name: 'Figure' });
    await chooseImage(dialog);
    await userEvent.type(within(dialog).getByLabelText('Description'), 'Zwei Formen');
    const language = within(dialog).getByLabelText('Language');
    expect(language).toHaveValue('en-GB');
    await userEvent.clear(language);
    await userEvent.type(language, 'de');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));

    await waitFor(() => expect(figureOf(view)).toMatchObject({ asset: RED }));
    expect(figureOf(view)!.alternative).toEqual({ kind: 'inherited' });
    expect(asked.find((each) => each.route === 'POST /v1/spaces/s1/asset-uploads')?.body).toEqual({
      alternative: { text: 'Zwei Formen', language: 'de' },
    });
    expect(asked.find((each) => each.route.startsWith('PUT /v1/asset-uploads'))?.body).toEqual({
      bytes: pngBytes.length,
    });
    expect(screen.queryByRole('dialog', { name: 'Figure' })).toBeNull();

    // The panel reads the image's own description, and its own text takes the component's language,
    // which the model holds without a tag of its own.
    const settings = await settingsOf(await screen.findByRole('group', { name: 'Figure' }));
    expect(await within(settings).findByText(/Zwei Formen/)).toBeInTheDocument();
    await userEvent.click(within(settings).getByLabelText('Describe it here'));
    await userEvent.type(within(settings).getByLabelText('Its own description'), 'Two shapes');
    await waitFor(() =>
      expect(figureOf(view)!.alternative).toEqual({ kind: 'own', text: 'Two shapes' }),
    );
    expect(fromEditor(view.state.doc).language).toBe('en-GB');
  });

  it('will not upload until the image is described or said to be decorative, and makes a decorative one', async () => {
    const { asked, surface } = openWith(content('Unbox the printer.'), uploads(RED));
    const view = await surface();
    selectText(view, 19, 19);
    await userEvent.click(screen.getByRole('button', { name: 'Figure' }));
    const dialog = await screen.findByRole('dialog', { name: 'Figure' });
    await chooseImage(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    expect(
      within(dialog).getByText('Describe the image, or say it is decorative.'),
    ).toBeInTheDocument();
    expect(asked.some((each) => each.route.includes('asset-uploads'))).toBe(false);

    await userEvent.click(within(dialog).getByLabelText('It is decorative'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    await waitFor(() =>
      expect(figureOf(view)).toMatchObject({ alternative: { kind: 'decorative' } }),
    );
    expect(asked.find((each) => each.route === 'POST /v1/spaces/s1/asset-uploads')?.body).toEqual({
      alternative: null,
    });
  });

  it('says why an image was refused, in words, and inserts nothing', async () => {
    const { surface } = openWith(
      content('Unbox the printer.'),
      uploads(RED, () =>
        json(400, { code: 'asset_format_not_permitted', message: 'x', traceId: 't' }),
      ),
    );
    const view = await surface();
    selectText(view, 19, 19);
    await userEvent.click(screen.getByRole('button', { name: 'Figure' }));
    const dialog = await screen.findByRole('dialog', { name: 'Figure' });
    await chooseImage(dialog);
    await userEvent.click(within(dialog).getByLabelText('It is decorative'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    expect(
      await within(dialog).findByText('This is not a PNG or a JPEG image.'),
    ).toBeInTheDocument();
    expect(figureOf(view)).toBeUndefined();
  });

  it('AST-015 sets a figure decorative from its panel, and deletes it', async () => {
    const { surface } = openWith(aFigure({ kind: 'inherited' }), assetVersion(RED, null));
    const view = await surface();
    caretInCaption(view);
    const panel = await screen.findByRole('group', { name: 'Figure' });
    const settings = await settingsOf(panel);
    // The image has no description of its own, which the dialog says rather than leaving it to publish.
    expect(await within(settings).findByText(/has no description/)).toBeInTheDocument();
    await userEvent.click(within(settings).getByLabelText('Decorative'));
    await waitFor(() => expect(figureOf(view)!.alternative).toEqual({ kind: 'decorative' }));
    await userEvent.click(within(settings).getByRole('button', { name: 'Done' }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Delete figure' }));
    expect(figureOf(view)).toBeUndefined();
  });

  it('replaces the image and keeps the figure, its identity and its caption', async () => {
    const { surface } = openWith(aFigure({ kind: 'own', text: 'Red' }), {
      ...uploads(BLUE),
      ...assetVersion(RED, null),
      ...assetVersion(BLUE, null),
    });
    const view = await surface();
    caretInCaption(view);
    const panel = await screen.findByRole('group', { name: 'Figure' });
    await userEvent.click(within(panel).getByRole('button', { name: 'Replace image' }));
    const dialog = await screen.findByRole('dialog', { name: 'Replace image' });
    await chooseImage(dialog);
    await userEvent.click(within(dialog).getByLabelText('It is decorative'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(figureOf(view)).toMatchObject({ asset: BLUE }));
    expect(figureOf(view)).toMatchObject({ id: 'f1', alternative: { kind: 'decorative' } });
  });

  it('marks an image that does not load in its place, since the reader may not see it', async () => {
    const { surface } = openWith(aFigure({ kind: 'decorative' }), assetVersion(RED, null));
    await surface();
    const image = document.querySelector('.aw-figure-image img')!;
    expect(image).not.toBeNull();
    fireEvent.error(image);
    expect(image.parentElement).toHaveClass('aw-image-missing');
    expect(image.parentElement).toHaveAttribute('data-missing', 'An image you may not see');
  });

  // The final review's findings, each reproduced before it was fixed.
  const figureBlock = (id: string, asset: string, alternative: unknown) => ({
    type: 'figure',
    id,
    asset,
    imageStyle: 'figure',
    caption: [{ type: 'text', value: id, marks: [] }],
    alternative,
  });
  const alternativeOf = (view: EditorView, id: string) =>
    (
      fromEditor(view.state.doc).content.find((block) => block.id === id) as
        { alternative: unknown } | undefined
    )?.alternative;

  it('keeps the dialog open, and says so, when the service cannot be reached', async () => {
    const { surface } = openWith(content('Unbox the printer.'), {
      'POST /v1/spaces/s1/asset-uploads': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const view = await surface();
    selectText(view, 19, 19);
    await userEvent.click(screen.getByRole('button', { name: 'Figure' }));
    const dialog = await screen.findByRole('dialog', { name: 'Figure' });
    await chooseImage(dialog);
    await userEvent.click(within(dialog).getByLabelText('It is decorative'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    expect(
      await within(dialog).findByText('The image could not be uploaded. Try again.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(figureOf(view)).toBeUndefined();
  });

  it("does not carry one figure's own description over to another", async () => {
    const { surface } = openWith(
      blocksOf(
        para('b1', 'Before.'),
        figureBlock('f1', RED, { kind: 'own', text: 'Alpha text' }),
        figureBlock('f2', BLUE, { kind: 'inherited' }),
      ),
      { ...assetVersion(RED, null), ...assetVersion(BLUE, null) },
    );
    const view = await surface();
    caretInCaption(view, 0);
    let settings = await settingsOf(await screen.findByRole('group', { name: 'Figure' }));
    expect(within(settings).getByLabelText('Its own description')).toHaveValue('Alpha text');
    await userEvent.click(within(settings).getByRole('button', { name: 'Done' }));
    caretInCaption(view, 1);
    settings = await settingsOf(await screen.findByRole('group', { name: 'Figure' }));
    await userEvent.click(within(settings).getByLabelText('Describe it here'));
    expect(within(settings).getByLabelText('Its own description')).toHaveValue('');
    expect(alternativeOf(view, 'f2')).toEqual({ kind: 'inherited' });
  });

  it('keeps nothing an emptied description held, and says the figure keeps what it had', async () => {
    const { surface } = openWith(aFigure({ kind: 'inherited' }), assetVersion(RED, null));
    const view = await surface();
    caretInCaption(view);
    const settings = await settingsOf(await screen.findByRole('group', { name: 'Figure' }));
    await userEvent.click(within(settings).getByLabelText('Describe it here'));
    const field = within(settings).getByLabelText('Its own description');
    await userEvent.type(field, 'Red');
    await waitFor(() => expect(figureOf(view)!.alternative).toEqual({ kind: 'own', text: 'Red' }));
    await userEvent.type(field, '{Backspace}{Backspace}{Backspace}');
    await waitFor(() => expect(figureOf(view)!.alternative).toEqual({ kind: 'inherited' }));
    expect(field).toHaveValue('');
    expect(within(settings).getByLabelText('Describe it here')).toBeChecked();
    expect(
      within(settings).getByText('Until something is typed here, the figure keeps what it had.'),
    ).toBeInTheDocument();
  });

  it('follows the figure through an undo and a redo of its own description', async () => {
    const { surface } = openWith(aFigure({ kind: 'inherited' }), assetVersion(RED, null));
    const view = await surface();
    caretInCaption(view);
    const settings = await settingsOf(await screen.findByRole('group', { name: 'Figure' }));
    await userEvent.click(within(settings).getByLabelText('Describe it here'));
    await userEvent.type(within(settings).getByLabelText('Its own description'), 'Red');
    await waitFor(() => expect(figureOf(view)!.alternative).toEqual({ kind: 'own', text: 'Red' }));
    act(() => {
      fireEvent.keyDown(view.dom, { key: 'z', ctrlKey: true });
    });
    await waitFor(() =>
      expect(within(settings).getByLabelText("Use the image's description")).toBeChecked(),
    );
    // Redo gives the figure back the very value the dialog set, which the dialog must still follow.
    act(() => {
      fireEvent.keyDown(view.dom, { key: 'y', ctrlKey: true });
    });
    await waitFor(() => expect(within(settings).getByLabelText('Describe it here')).toBeChecked());
    expect(within(settings).getByLabelText('Its own description')).toHaveValue('Red');
  });

  it('opens Figure settings from its panel, the focus on the chosen alternative, and gives the focus back on Done', async () => {
    const { surface } = openWith(aFigure({ kind: 'decorative' }), assetVersion(RED, null));
    const view = await surface();
    caretInCaption(view);
    const panel = await screen.findByRole('group', { name: 'Figure' });
    const opener = within(panel).getByRole('button', { name: 'Figure settings' });
    expect(opener).toHaveAttribute('aria-haspopup', 'dialog');
    // The alternatives are the dialog's alone: nothing on the panel chooses one (ADR-0055).
    expect(within(panel).queryByRole('radio')).toBeNull();

    const settings = await settingsOf(panel);
    expect(within(settings).getByLabelText('Decorative')).toHaveFocus();
    expect(within(settings).getByRole('switch', { name: 'Numbered' })).toBeChecked();
    expect(within(settings).getByRole('button', { name: 'Replace image' })).toBeInTheDocument();
    expect(within(settings).getByRole('button', { name: 'Delete figure' })).toBeInTheDocument();
    await userEvent.click(within(settings).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Figure settings' })).toBeNull();
    expect(opener).toHaveFocus();
  });

  it.each([
    [
      'inherited, the image described',
      { kind: 'inherited' },
      { text: 'Shapes', language: 'en-GB' },
      'From the image',
      "Use the image's description",
    ],
    [
      'inherited, the image undescribed',
      { kind: 'inherited' },
      null,
      'Needed',
      "Use the image's description",
    ],
    ['its own', { kind: 'own', text: 'Red' }, null, 'Described here', 'Describe it here'],
    ['decorative', { kind: 'decorative' }, null, 'Decorative', 'Decorative'],
  ])(
    'says on the line how the alternative text is given, %s, and opens Figure settings on it',
    async (_, alternative, described, words, chosen) => {
      const { surface } = openWith(aFigure(alternative), assetVersion(RED, described));
      const view = await surface();
      caretInCaption(view);
      const panel = await screen.findByRole('group', { name: 'Figure' });
      const chip = await within(panel).findByRole('button', {
        name: `Alternative text: ${words}. Change it`,
      });
      expect(chip).toHaveAttribute('aria-haspopup', 'dialog');
      expect(chip).toHaveTextContent(`Alt text${words}`);
      await userEvent.click(chip);
      const settings = await screen.findByRole('dialog', { name: 'Figure settings' });
      expect(within(settings).getByLabelText(chosen)).toHaveFocus();
    },
  );

  it('says why the alternative text is needed, on the chip, as it is hovered or focused', async () => {
    const { surface } = openWith(aFigure({ kind: 'inherited' }), assetVersion(RED, null));
    const view = await surface();
    caretInCaption(view);
    const panel = await screen.findByRole('group', { name: 'Figure' });
    const chip = await within(panel).findByRole('button', {
      name: 'Alternative text: Needed. Change it',
    });
    expect(chip).toHaveAttribute('data-tone', 'warn');
    expect(chip).toHaveAccessibleDescription(
      'The image has no description of its own, so this figure cannot be published until it is given one here.',
    );
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => chip.focus());
    expect(screen.getByRole('tooltip')).toBeVisible();
  });

  it('sets the line in one row: the kind, image style, Numbered, the chip, Replace and Delete as icons, and Figure settings', async () => {
    const { surface } = openWith(aFigure({ kind: 'decorative' }), assetVersion(RED, null));
    const view = await surface();
    caretInCaption(view);
    const panel = await screen.findByRole('group', { name: 'Figure' });
    expect(within(panel).getByText('Figure')).toBeInTheDocument();
    expect(within(panel).getByRole('switch', { name: 'Numbered' })).toBeChecked();
    for (const name of ['Replace image', 'Delete figure', 'Figure settings']) {
      expect(within(panel).getByRole('button', { name })).toHaveAttribute('title', name);
    }
    // Replace and Delete are icons, their words only their names.
    expect(within(panel).getByRole('button', { name: 'Delete figure' })).not.toHaveTextContent(
      'Delete',
    );
  });

  it('marks the figure unnumbered from Figure settings, as from its panel', async () => {
    const { surface } = openWith(aFigure({ kind: 'decorative' }), assetVersion(RED, null));
    const view = await surface();
    caretInCaption(view);
    const settings = await settingsOf(await screen.findByRole('group', { name: 'Figure' }));
    await userEvent.click(within(settings).getByRole('switch', { name: 'Numbered' }));
    await waitFor(() => expect(figureOf(view)).toMatchObject({ numbered: false }));
    expect(within(settings).getByRole('switch', { name: 'Numbered' })).not.toBeChecked();
  });

  it('replaces the image from Figure settings, closing it for the Replace image dialog', async () => {
    const { surface } = openWith(aFigure({ kind: 'decorative' }), assetVersion(RED, null));
    const view = await surface();
    caretInCaption(view);
    const settings = await settingsOf(await screen.findByRole('group', { name: 'Figure' }));
    await userEvent.click(within(settings).getByRole('button', { name: 'Replace image' }));
    expect(await screen.findByRole('dialog', { name: 'Replace image' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Figure settings' })).toBeNull();
  });

  it('opens Figure settings to read where the figure cannot be changed, every control disabled and Close in place of Done', async () => {
    const { surface } = open(
      {
        'GET /v1/components/{id}': () =>
          json(200, opened({ mayEdit: false, content: aFigure({ kind: 'decorative' }) })),
        ...assetVersion(RED, null),
      },
      quick,
      true,
    );
    const view = await surface();
    caretInCaption(view);
    const panel = await screen.findByRole('group', { name: 'Figure' });
    // The line's controls say they are disabled, and stay in reach of the keyboard.
    const numbered = within(panel).getByRole('switch', { name: 'Numbered' });
    expect(numbered).toHaveAttribute('aria-disabled', 'true');
    expect(numbered).toBeEnabled();
    await userEvent.click(numbered);
    expect(figureOf(view)).not.toHaveProperty('numbered');
    expect(within(panel).getByRole('button', { name: 'Delete figure' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    const settings = await settingsOf(panel);
    expect(within(settings).getByLabelText('Decorative')).toBeChecked();
    expect(within(settings).getByLabelText('Decorative')).toBeDisabled();
    expect(within(settings).getByRole('switch', { name: 'Numbered' })).toBeDisabled();
    expect(within(settings).queryByRole('button', { name: 'Replace image' })).toBeNull();
    expect(within(settings).queryByRole('button', { name: 'Delete figure' })).toBeNull();
    expect(within(settings).queryByRole('button', { name: 'Done' })).toBeNull();
    // Two Closes: the dialog's own, in its corner, and the footer's in place of Done.
    const closes = within(settings).getAllByRole('button', { name: 'Close' });
    await userEvent.click(closes[closes.length - 1]!);
    expect(screen.queryByRole('dialog', { name: 'Figure settings' })).toBeNull();
  });

  it('STR-071 marks the figure unnumbered from its Numbered box, and numbered again, its caption kept', async () => {
    const { surface } = openWith(aFigure({ kind: 'decorative' }), assetVersion(RED, null));
    const view = await surface();
    caretInCaption(view);
    const panel = await screen.findByRole('group', { name: 'Figure' });
    const box = within(panel).getByRole('switch', { name: 'Numbered' });
    expect(box).toBeChecked();
    expect(figureOf(view)).not.toHaveProperty('numbered');

    await userEvent.click(box);
    await waitFor(() => expect(figureOf(view)).toMatchObject({ numbered: false }));
    expect(within(panel).getByRole('switch', { name: 'Numbered' })).not.toBeChecked();
    expect(figureOf(view)).toMatchObject({
      id: 'f1',
      caption: [{ type: 'text', value: 'Shapes', marks: [] }],
    });

    // An undo takes it back to numbered, the box following.
    act(() => {
      fireEvent.keyDown(view.dom, { key: 'z', ctrlKey: true });
    });
    await waitFor(() =>
      expect(within(panel).getByRole('switch', { name: 'Numbered' })).toBeChecked(),
    );
    expect(figureOf(view)).not.toHaveProperty('numbered');

    // And the box marks it unnumbered and numbered again.
    await userEvent.click(within(panel).getByRole('switch', { name: 'Numbered' }));
    await waitFor(() => expect(figureOf(view)).toMatchObject({ numbered: false }));
    await userEvent.click(within(panel).getByRole('switch', { name: 'Numbered' }));
    await waitFor(() => expect(figureOf(view)).not.toHaveProperty('numbered'));
  });

  it('offers Figure only where a figure can be placed', async () => {
    const { surface } = openWith(aFigure({ kind: 'decorative' }), assetVersion(RED, null));
    const view = await surface();
    caretInCaption(view);
    const button = screen.getByRole('button', { name: 'Figure' });
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'));
    await userEvent.click(button);
    expect(screen.queryByRole('dialog', { name: 'Figure' })).toBeNull();
    act(() => selectText(view, 3, 3));
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'false'));
  });

  it('places nothing once the component can no longer be edited, and says so', async () => {
    let checked: ((response: Response) => void) | undefined;
    const { surface } = openWith(content('Unbox the printer.'), {
      ...uploads(RED),
      [`GET /v1/asset-uploads/${UPLOAD}`]: () =>
        new Promise<Response>((resolve) => {
          checked = resolve;
        }),
      'PUT /v1/components/{id}/iterations/{session}/1': () =>
        json(409, { code: 'iteration_stale', message: 'stale', traceId: 't', latest: 7 }),
    });
    const view = await surface();
    selectText(view, 19, 19);
    await userEvent.click(screen.getByRole('button', { name: 'Figure' }));
    const dialog = await screen.findByRole('dialog', { name: 'Figure' });
    await chooseImage(dialog);
    await userEvent.click(within(dialog).getByLabelText('It is decorative'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(checked).toBeDefined());
    act(() => view.dispatch(view.state.tr.insertText(' Keep the box.', 19)));
    await screen.findByRole('button', { name: 'Continue' });
    act(() => checked!(json(200, uploadView('ready', { assetVersion: RED }))));
    expect(
      await within(dialog).findByText(
        'This component can no longer be edited here, so the image was not placed.',
      ),
    ).toBeInTheDocument();
    expect(figureOf(view)).toBeUndefined();
  });

  it('will not upload a description in a language that is not a tag, and says so', async () => {
    const { asked, surface } = openWith(content('Unbox the printer.'), uploads(RED));
    const view = await surface();
    selectText(view, 19, 19);
    await userEvent.click(screen.getByRole('button', { name: 'Figure' }));
    const dialog = await screen.findByRole('dialog', { name: 'Figure' });
    await chooseImage(dialog);
    await userEvent.type(within(dialog).getByLabelText('Description'), 'Two shapes');
    const language = within(dialog).getByLabelText('Language');
    await userEvent.clear(language);
    await userEvent.type(language, 'en GB');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    expect(
      within(dialog).getByText('Give the language as a tag, such as en-GB.'),
    ).toBeInTheDocument();
    expect(asked.some((each) => each.route.includes('asset-uploads'))).toBe(false);
  });

  describe('an inline image (figures 4)', () => {
    const inline = (alternative: unknown, asset = RED) => ({
      type: 'image',
      asset,
      imageStyle: 'inline',
      alternative,
    });
    const aParagraphWithAnImage = (alternative: unknown) =>
      blocksOf({
        type: 'paragraph',
        id: 'b1',
        style: 'body',
        content: [{ type: 'text', value: 'Press ', marks: [] }, inline(alternative)],
      });
    const runsOf = (view: EditorView) =>
      (fromEditor(view.state.doc).content[0] as { content: unknown[] }).content;
    /** The first inline image, selected whole, as a click on it selects it. */
    const selectTheImage = (view: EditorView) =>
      act(() => {
        let at = -1;
        view.state.doc.descendants((node, pos) => {
          if (at === -1 && node.type.name === 'image') at = pos;
          return at === -1;
        });
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at)));
      });

    it('CNT-087 places an image in a run of text from the Image button, described as it is uploaded', async () => {
      const { asked, surface } = openWith(content('Unbox the printer.'), {
        ...uploads(RED),
        ...assetVersion(RED, { text: 'A printer', language: 'en-GB' }),
      });
      const view = await surface();
      selectText(view, 6, 6);
      await userEvent.click(screen.getByRole('button', { name: 'Image' }));
      const dialog = await screen.findByRole('dialog', { name: 'Image' });
      await chooseImage(dialog);
      await userEvent.type(within(dialog).getByLabelText('Description'), 'A printer');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
      await waitFor(() =>
        expect(runsOf(view)).toEqual([
          { type: 'text', value: 'Unbox', marks: [] },
          inline({ kind: 'inherited' }),
          { type: 'text', value: ' the printer.', marks: [] },
        ]),
      );
      expect(asked.find((each) => each.route === 'POST /v1/spaces/s1/asset-uploads')?.body).toEqual(
        {
          alternative: { text: 'A printer', language: 'en-GB' },
        },
      );
    });

    it('offers Image only where an image may stand', async () => {
      const { surface } = openWith(aFigure({ kind: 'decorative' }), assetVersion(RED, null));
      const view = await surface();
      const button = screen.getByRole('button', { name: 'Image' });
      caretInCaption(view);
      await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'));
      act(() => selectText(view, 3, 3));
      await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'false'));
    });

    it('describes, replaces and deletes an image selected whole, from its panel', async () => {
      const { surface } = openWith(aParagraphWithAnImage({ kind: 'inherited' }), {
        ...uploads(BLUE),
        ...assetVersion(RED, null),
        ...assetVersion(BLUE, null),
      });
      const view = await surface();
      selectTheImage(view);
      const panel = await screen.findByRole('group', { name: 'Image' });
      // An image in a line takes no number, so its panel has no Numbered box (STR-071's is a figure's).
      expect(within(panel).queryByRole('switch', { name: 'Numbered' })).toBeNull();
      const settings = await settingsOf(panel, 'Image settings');
      // An image in a line is never numbered, in its settings either.
      expect(within(settings).queryByRole('switch', { name: 'Numbered' })).toBeNull();
      // Said of the image, not a figure (final review).
      expect(
        await within(settings).findByText(
          /so this image cannot be published until it is given one here/,
        ),
      ).toBeInTheDocument();
      await userEvent.click(within(settings).getByLabelText('Decorative'));
      await waitFor(() => expect(runsOf(view)[1]).toEqual(inline({ kind: 'decorative' })));
      await userEvent.click(within(settings).getByRole('button', { name: 'Done' }));

      await userEvent.click(within(panel).getByRole('button', { name: 'Replace image' }));
      const dialog = await screen.findByRole('dialog', { name: 'Replace image' });
      await chooseImage(dialog);
      await userEvent.click(within(dialog).getByLabelText('It is decorative'));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
      await waitFor(() => expect(runsOf(view)[1]).toEqual(inline({ kind: 'decorative' }, BLUE)));

      selectTheImage(view);
      const again = await screen.findByRole('group', { name: 'Image' });
      await userEvent.click(within(again).getByRole('button', { name: 'Delete image' }));
      expect(runsOf(view)).toEqual([{ type: 'text', value: 'Press ', marks: [] }]);
    });

    it('marks an inline image that does not load in its place', async () => {
      const { surface } = openWith(
        aParagraphWithAnImage({ kind: 'decorative' }),
        assetVersion(RED, null),
      );
      await surface();
      const image = document.querySelector('.aw-inline-image')!;
      expect(image).not.toBeNull();
      fireEvent.error(image);
      expect(image.parentElement).toHaveClass('aw-image-missing');
      expect(image.parentElement).toHaveAttribute('data-missing', 'An image you may not see');
    });
  });
});

describe('footnotes and the table note in the editor (footnotes 1)', () => {
  // Typing saves as the author goes, and a slower machine batches fewer keystrokes into each save.
  const everySave = Object.fromEntries(
    Array.from({ length: 64 }, (_, at) => [
      `PUT /v1/components/{id}/iterations/{session}/${at + 1}`,
      () => json(200, { sequence: at + 1, lock }),
    ]),
  );
  const openWith = (stored: unknown) =>
    open(
      {
        'GET /v1/components/{id}': () => json(200, opened({ content: stored })),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        ...everySave,
      },
      quick,
      true,
    );
  const footnote = (id: string, ...paragraphs: unknown[]) => ({
    type: 'footnote',
    id,
    anchor: { kind: 'span' },
    content: paragraphs,
  });
  const withFootnote = blocksOf({
    type: 'paragraph',
    id: 'b1',
    style: 'body',
    content: [
      { type: 'text', value: 'Unbox the printer', marks: [] },
      footnote('f1', para('fp1', 'Twice.')),
      { type: 'text', value: '.', marks: [] },
    ],
  });
  const runsOf = (view: EditorView) =>
    (fromEditor(view.state.doc).content[0] as { content: unknown[] }).content;
  /** The first footnote, selected whole, as a click on its mark selects it. */
  const selectTheFootnote = (view: EditorView) =>
    act(() => {
      let at = -1;
      view.state.doc.descendants((node, pos) => {
        if (at === -1 && node.type.name === 'footnote') at = pos;
        return at === -1;
      });
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at)));
    });
  /** Types into the footnote's own editor, as its keystrokes arrive. */
  const typeInFootnote = (view: EditorView, text: string) =>
    act(() => {
      const inner = openFootnote(view)!;
      inner.dispatch(inner.state.tr.insertText(text));
    });

  it('opens a component holding a footnote for editing, its mark named Footnote', async () => {
    const { surface } = openWith(withFootnote);
    await surface();
    expect(screen.queryByText(/shown for reading only/)).toBeNull();
    expect(screen.getByRole('img', { name: 'Footnote' })).toBeInTheDocument();
  });

  it('CNT-036 places a footnote at the cursor from the toolbar, opens its text with the focus, and saves what is typed', async () => {
    const { asked, surface } = openWith(content('Unbox the printer.'));
    const view = await surface();
    selectText(view, 18, 18);
    await userEvent.click(screen.getByRole('button', { name: 'Footnote' }));

    const text = await screen.findByRole('textbox', { name: 'Footnote text' });
    expect(text).toHaveFocus();
    typeInFootnote(view, 'Twice.');
    const [, note] = runsOf(view) as [unknown, { content: { content: unknown[] }[] }];
    expect(note).toMatchObject({ type: 'footnote', anchor: { kind: 'span' } });
    expect(note.content[0]!.content).toEqual([{ type: 'text', value: 'Twice.', marks: [] }]);
    await waitFor(() =>
      expect(
        asked.some(
          (each) =>
            each.route.startsWith('PUT /v1/components/{id}/iterations/') &&
            JSON.stringify(each.body).includes('Twice.'),
        ),
      ).toBe(true),
    );
  });

  it('opens its text while it is selected, and closes it when the cursor leaves', async () => {
    const { surface } = openWith(withFootnote);
    const view = await surface();
    expect(screen.queryByRole('textbox', { name: 'Footnote text' })).toBeNull();
    selectTheFootnote(view);
    const text = await screen.findByRole('textbox', { name: 'Footnote text' });
    expect(text).toHaveTextContent('Twice.');
    selectText(view, 2, 2);
    expect(screen.queryByRole('textbox', { name: 'Footnote text' })).toBeNull();
  });

  it('Enter on the mark puts the focus in its text, and Escape brings it back to the mark', async () => {
    const { surface } = openWith(withFootnote);
    const view = await surface();
    selectTheFootnote(view);
    view.focus();
    fireEvent.keyDown(view.dom, { key: 'Enter' });
    const text = screen.getByRole('textbox', { name: 'Footnote text' });
    expect(text).toHaveFocus();
    expect(runsOf(view)).toHaveLength(3);

    fireEvent.keyDown(text, { key: 'Escape' });
    expect(view.hasFocus()).toBe(true);
    expect(screen.getByRole('textbox', { name: 'Footnote text' })).toBeInTheDocument();
  });

  it("undoes the footnote's typing with the component's own history", async () => {
    const { surface } = openWith(withFootnote);
    const view = await surface();
    selectTheFootnote(view);
    typeInFootnote(view, 'Once. ');
    expect(screen.getByRole('textbox', { name: 'Footnote text' })).toHaveTextContent(
      'Once. Twice.',
    );
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Footnote text' }), {
      key: 'z',
      ctrlKey: true,
    });
    expect(screen.getByRole('textbox', { name: 'Footnote text' })).toHaveTextContent('Twice.');
    expect(JSON.stringify(runsOf(view))).not.toContain('Once.');
  });

  it("the toolbar acts on the footnote's text while it is open, and offers nothing that cannot go there", async () => {
    const { surface } = openWith(withFootnote);
    const view = await surface();
    selectTheFootnote(view);
    act(() => {
      const inner = openFootnote(view)!;
      inner.dispatch(
        inner.state.tr.setSelection(
          Selection.fromJSON(inner.state.doc, { type: 'text', anchor: 1, head: 6 }),
        ),
      );
    });
    await userEvent.click(screen.getByRole('button', { name: 'Strong' }));
    const [first, note] = runsOf(view) as [
      { marks: unknown[] },
      { content: { content: { marks: { type: string }[] }[] }[] },
    ];
    expect(note.content[0]!.content[0]!.marks.map((mark) => mark.type)).toEqual(['strong']);
    expect(first.marks).toEqual([]);
    for (const name of ['Bulleted list', 'Table', 'Footnote', 'Figure', 'Image']) {
      expect(screen.getByRole('button', { name }), name).toHaveAttribute('aria-disabled', 'true');
    }
  });

  it("the link dialog names the words selected in the footnote's text (final review, finding 4)", async () => {
    const { surface } = openWith(withFootnote);
    const view = await surface();
    selectTheFootnote(view);
    act(() => {
      const inner = openFootnote(view)!;
      inner.dispatch(
        inner.state.tr.setSelection(
          Selection.fromJSON(inner.state.doc, { type: 'text', anchor: 1, head: 4 }),
        ),
      );
    });
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    const dialog = await screen.findByRole('dialog', { name: 'Link' });
    expect(within(dialog).getByText('Twi').tagName).toBe('MARK');
  });

  it("a paste into the footnote's text goes through admission, and the text stays open", async () => {
    const { surface } = openWith(withFootnote);
    const view = await surface();
    selectTheFootnote(view);
    const text = screen.getByRole('textbox', { name: 'Footnote text' });
    act(() => {
      text.dispatchEvent(pasteEvent({ 'text/plain': 'Once.\n\nThen again.' }));
    });
    const [, note] = runsOf(view) as [unknown, { content: unknown[] }];
    expect(note.content).toHaveLength(2);
    expect(screen.getByRole('textbox', { name: 'Footnote text' })).toBeInTheDocument();
  });

  it('CNT-038 adds a note to a table from its panel, saves what is typed in it, and removes it', async () => {
    const { surface } = openWith(
      blocksOf(para('b1', 'Before.'), {
        type: 'table',
        id: 't1',
        style: 'table',
        caption: [{ type: 'text', value: 'Readings', marks: [] }],
        headerRows: 0,
        headerColumns: 0,
        rows: [{ cells: [{ content: [para('d1', 'York')], colspan: 1, rowspan: 1 }] }],
      }),
    );
    const view = await surface();
    caretIn(view, 'd1');
    const panel = await screen.findByRole('group', { name: 'Table' });
    expect(within(panel).getByRole('button', { name: 'Remove note' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await userEvent.click(within(panel).getByRole('button', { name: 'Add note' }));
    expect(view.state.selection.$from.parent.type.name).toBe('tableNote');
    act(() => view.dispatch(view.state.tr.insertText('Estimated.')));
    const tableOf = () =>
      fromEditor(view.state.doc).content.find((block) => block.type === 'table') as {
        note?: unknown;
      };
    expect(tableOf().note).toEqual([{ type: 'text', value: 'Estimated.', marks: [] }]);
    const again = screen.getByRole('group', { name: 'Table' });
    expect(within(again).getByRole('button', { name: 'Add note' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await userEvent.click(within(again).getByRole('button', { name: 'Remove note' }));
    expect(tableOf().note).toBeUndefined();
  });
});
