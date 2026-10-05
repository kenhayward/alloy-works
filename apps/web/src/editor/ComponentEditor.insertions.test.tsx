import { equationAlternative } from '@alloy-works/domain';
import {
  fromEditor,
  NodeSelection,
  openFootnote,
  Selection,
  type EditorView,
} from '@alloy-works/editor';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shimRangeMeasurement } from '../test/range.js';
import { ComponentEditor } from './ComponentEditor.js';
import { describeEquation } from './speech.js';
import { DEFAULT_PRESENTATION } from '../theme/presentation.fixture.js';
import {
  open,
  COMPONENT,
  SESSION,
  ADA,
  content,
  para,
  opened,
  lock,
  json,
  service,
  quick,
  selectText,
  languageField,
  caretIn,
  blocksOf,
} from './test/componentEditor.js';

shimRangeMeasurement();

afterEach(() => vi.restoreAllMocks());

describe('cross-references in the editor (cross-references 1)', () => {
  // Every change saves as the author goes; enough answered that no test runs out of them.
  const everySave = Object.fromEntries(
    Array.from({ length: 64 }, (_, at) => [
      `PUT /v1/components/{id}/iterations/{session}/${at + 1}`,
      () => json(200, { sequence: at + 1, lock }),
    ]),
  );
  const answers = (stored: unknown) => ({
    'GET /v1/components/{id}': () => json(200, opened({ content: stored })),
    'POST /v1/components/{id}/lock': () => json(200, { lock }),
    ...everySave,
  });
  const openWith = (
    stored: unknown,
    extra: Partial<React.ComponentProps<typeof ComponentEditor>> = {},
  ) => open(answers(stored), quick, true, extra);

  const readings = {
    type: 'table',
    id: 't1',
    style: 'table',
    caption: [{ type: 'text', value: 'Readings', marks: [] }],
    headerRows: 0,
    headerColumns: 0,
    rows: [{ cells: [{ content: [para('c1', 'York')], colspan: 1, rowspan: 1 }] }],
  };
  /** A paragraph referring to the table after it. */
  const referring = blocksOf(
    {
      type: 'paragraph',
      id: 'b1',
      style: 'body',
      content: [
        { type: 'text', value: 'See ', marks: [] },
        {
          type: 'crossReference',
          id: 'x1',
          target: { kind: 'block', block: 't1' },
          display: 'number',
        },
      ],
    },
    readings,
  );
  /** What a document offers where this component is edited in it: a section, and its table. */
  const inADocument = {
    targets: [
      {
        target: { kind: 'node', node: 'aaaaaaaaaaaaaaaaaaaaaaaaaa' },
        kind: 'section',
        label: '1',
        title: 'Introduction',
        relative: 'above',
      },
      {
        target: { kind: 'block', block: 't1' },
        kind: 'table',
        label: 'Table 1.1',
        title: 'Readings',
        relative: null,
      },
    ],
  } as const;

  /** Every reference the stored document holds, wherever it stands, as a save would send it. */
  const referencesIn = (view: EditorView) => {
    const found: Record<string, unknown>[] = [];
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object' && value !== null) {
        if ((value as { type?: unknown }).type === 'crossReference') {
          found.push(value as Record<string, unknown>);
        }
        Object.values(value).forEach(walk);
      }
    };
    walk(fromEditor(view.state.doc));
    return found;
  };
  /** What each reference on the surface shows, in order. */
  const drawn = () =>
    [...document.querySelectorAll('.ProseMirror [data-reference]')].map((each) => each.textContent);
  /** The words each radio of a group is named by. */
  const choices = (dialog: HTMLElement, group: string) =>
    within(within(dialog).getByRole('group', { name: group }))
      .getAllByRole('radio')
      .map((each) => (each.closest('label') as HTMLElement).textContent);
  /** Selects the first node of that type whole, as a click on it does. */
  const selectFirst = (view: EditorView, type: string) =>
    act(() => {
      let at = -1;
      view.state.doc.descendants((node, pos) => {
        if (at === -1 && node.type.name === type) at = pos;
        return at === -1;
      });
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at)));
    });

  it('opens a component holding a reference for editing, showing what it refers to', async () => {
    const { surface } = openWith(referring);
    await surface();
    expect(screen.queryByText(/shown for reading only/)).toBeNull();
    expect(drawn()).toEqual(['Table: Readings']);
  });

  it('offers its own table on its own as "Table: Readings", and places a reference to it', async () => {
    const { surface } = openWith(blocksOf(para('b1', 'See the readings.'), readings));
    const view = await surface();
    caretIn(view, 'b1');
    const button = screen.getByRole('button', { name: 'Reference' });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(button).toHaveAttribute('aria-disabled', 'false');
    await userEvent.click(button);

    const dialog = await screen.findByRole('dialog', { name: 'Reference' });
    expect(choices(dialog, 'Refer to')).toEqual(['Table: Readings']);
    expect(within(dialog).getByRole('radio', { name: 'Table: Readings' })).toBeChecked();
    expect(choices(dialog, 'Show as')).toEqual([
      'Number',
      'Title',
      'Number and title',
      'Page',
      'Above or below',
    ]);
    // Numbered by no document, so it shows its kind and caption whatever the form.
    expect(within(dialog).getByText(/It will show/)).toHaveTextContent(
      'It will show: Table: Readings',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Insert' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(referencesIn(view)).toMatchObject([
      { target: { kind: 'block', block: 't1' }, display: 'number' },
    ]);
    expect(drawn()).toEqual(['Table: Readings']);
  });

  it('opens the dialog from the keyboard alone, with Ctrl, Alt and X', async () => {
    const { surface } = openWith(blocksOf(para('b1', 'See the readings.'), readings));
    const view = await surface();
    await screen.findByRole('button', { name: 'Reference' });
    caretIn(view, 'b1');

    fireEvent.keyDown(view.dom, { key: 'x', ctrlKey: true, altKey: true });

    expect(await screen.findByRole('dialog', { name: 'Reference' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Table: Readings' })).toHaveFocus();
  });

  it('in a document, offers its sections and its numbered table, and the reference shows the label', async () => {
    const { surface } = openWith(blocksOf(para('b1', 'See the readings.'), readings), {
      referenceContext: inADocument,
    });
    const view = await surface();
    caretIn(view, 'b1');
    await userEvent.click(screen.getByRole('button', { name: 'Reference' }));

    const dialog = await screen.findByRole('dialog', { name: 'Reference' });
    expect(choices(dialog, 'Refer to')).toEqual(['1 Introduction', 'Table 1.1 Readings']);
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Table 1.1 Readings' }));
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Number' }));
    expect(within(dialog).getByText(/It will show/)).toHaveTextContent('It will show: Table 1.1');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Above or below' }));
    // The table stands after the paragraph the cursor is in.
    expect(within(dialog).getByText(/It will show/)).toHaveTextContent('It will show: below');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Number' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Insert' }));

    expect(referencesIn(view)).toMatchObject([
      { target: { kind: 'block', block: 't1' }, display: 'number' },
    ]);
    expect(drawn()).toEqual(['Table 1.1']);
  });

  it('in a document, offers a numbered block equation and the reference shows its label (equations 2)', async () => {
    const equation = {
      type: 'equation',
      id: 'e1',
      mathml:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" alttext="x squared"><msup><mi>x</mi><mn>2</mn></msup></math>',
      numbered: true,
    };
    const inADocumentWithEquation = {
      targets: [
        ...inADocument.targets,
        {
          target: { kind: 'block', block: 'e1' },
          kind: 'equation',
          label: 'Equation 1',
          title: null,
          relative: null,
        },
      ],
    } as const;
    const { surface } = openWith(blocksOf(para('b1', 'See the equation.'), equation), {
      referenceContext: inADocumentWithEquation,
    });
    const view = await surface();
    caretIn(view, 'b1');
    await userEvent.click(screen.getByRole('button', { name: 'Reference' }));

    const dialog = await screen.findByRole('dialog', { name: 'Reference' });
    expect(choices(dialog, 'Refer to')).toEqual(['1 Introduction', 'Equation 1']);
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Equation 1' }));
    // No title form: an equation's number is its label, and what it says is maths (ruling R7).
    expect(choices(dialog, 'Show as')).toEqual(['Number', 'Page', 'Above or below']);
    expect(within(dialog).getByText(/It will show/)).toHaveTextContent('It will show: Equation 1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Insert' }));

    expect(referencesIn(view)).toMatchObject([
      { target: { kind: 'block', block: 'e1' }, display: 'number' },
    ]);
    expect(drawn()).toEqual(['Equation 1']);
  });

  it('offers no title form of a section whose title holds an equation, which the publish would refuse (equations 3)', async () => {
    const { surface } = openWith(blocksOf(para('b1', 'See the growth.'), readings), {
      referenceContext: {
        targets: [
          ...inADocument.targets,
          // "Growth as" and x squared: named by its words, which a title form cannot print.
          {
            target: { kind: 'node', node: 'gggggggggggggggggggggggggg' },
            kind: 'section',
            label: '2',
            title: 'Growth as',
            relative: 'below',
            titleHoldsEquation: true,
          },
        ],
      },
    });
    const view = await surface();
    caretIn(view, 'b1');
    await userEvent.click(screen.getByRole('button', { name: 'Reference' }));

    const dialog = await screen.findByRole('dialog', { name: 'Reference' });
    await userEvent.click(within(dialog).getByRole('radio', { name: '2 Growth as' }));
    expect(choices(dialog, 'Show as')).toEqual(['Number', 'Page', 'Above or below']);
    expect(within(dialog).getByText(/It will show/)).toHaveTextContent('It will show: 2');
    // Any other section keeps all five.
    await userEvent.click(within(dialog).getByRole('radio', { name: '1 Introduction' }));
    expect(choices(dialog, 'Show as')).toEqual([
      'Number',
      'Title',
      'Number and title',
      'Page',
      'Above or below',
    ]);
  });

  it("shows the layout's own words for above and below, where the document carries them (cross-references 2, ruling R9)", async () => {
    const { surface } = openWith(blocksOf(para('b1', 'See the readings.'), readings), {
      referenceContext: { ...inADocument, words: { above: 'plus haut', below: 'plus bas' } },
    });
    const view = await surface();
    caretIn(view, 'b1');
    await userEvent.click(screen.getByRole('button', { name: 'Reference' }));

    const dialog = await screen.findByRole('dialog', { name: 'Reference' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Table 1.1 Readings' }));
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Above or below' }));
    // The table stands after the paragraph the cursor is in.
    expect(within(dialog).getByText(/It will show/)).toHaveTextContent('It will show: plus bas');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Insert' }));

    expect(drawn()).toEqual(['plus bas']);
  });

  it('offers a footnote by its number, with only the forms a footnote has', async () => {
    const { surface } = openWith(
      blocksOf(
        {
          type: 'paragraph',
          id: 'b1',
          style: 'body',
          content: [
            { type: 'text', value: 'Visited', marks: [] },
            {
              type: 'footnote',
              id: 'f1',
              anchor: { kind: 'span' },
              content: [para('fp1', 'Twice.')],
            },
          ],
        },
        para('b2', 'Then.'),
      ),
      {
        referenceContext: {
          targets: [
            {
              target: { kind: 'block', block: 'f1' },
              kind: 'footnote',
              label: '3',
              title: null,
              relative: null,
            },
          ],
        },
      },
    );
    const view = await surface();
    caretIn(view, 'b2');
    await userEvent.click(screen.getByRole('button', { name: 'Reference' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reference' });
    expect(within(dialog).getByRole('radio', { name: 'Footnote 3' })).toBeChecked();
    expect(choices(dialog, 'Show as')).toEqual(['Number', 'Page', 'Above or below']);
    expect(within(dialog).getByText(/It will show/)).toHaveTextContent('It will show: 3');
  });

  it('STR-071 offers a table marked unnumbered by its caption, with no number form, showing its caption', async () => {
    // What `documentTargets` offers of it, where the component is edited in a document.
    const { surface } = openWith(blocksOf({ ...readings, numbered: false }, para('b2', 'Then.')), {
      referenceContext: {
        targets: [
          {
            target: { kind: 'block', block: 't1' },
            kind: 'table',
            label: null,
            title: 'Readings',
            relative: null,
            unnumbered: true,
          },
        ],
      },
    });
    const view = await surface();
    caretIn(view, 'b2');
    await userEvent.click(screen.getByRole('button', { name: 'Reference' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reference' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Table: Readings' }));
    expect(choices(dialog, 'Show as')).toEqual(['Title', 'Page', 'Above or below']);
    expect(within(dialog).getByText(/It will show/)).toHaveTextContent('It will show: Readings');
  });

  /** A paragraph referring to `t1` in each form given, `x1`, `x2` and on, then the table and `b2`. */
  const referringIn = (table: object, ...displays: string[]) =>
    blocksOf(
      {
        type: 'paragraph',
        id: 'b1',
        style: 'body',
        content: [
          { type: 'text', value: 'See ', marks: [] },
          ...displays.map((display, at) => ({
            type: 'crossReference',
            id: `x${at + 1}`,
            target: { kind: 'block', block: 't1' },
            display,
          })),
        ],
      },
      table,
      para('b2', 'Then.'),
    );
  /** What the page last numbered: `t1` as Table 1.2, from before it was marked unnumbered. */
  const stale = {
    targets: [
      {
        target: { kind: 'block' as const, block: 't1' },
        kind: 'table' as const,
        label: 'Table 1.2',
        title: 'Readings',
        relative: null,
      },
    ],
  };

  it('STR-071 trusts the live table over a page that numbered it before it was marked unnumbered, offering no number form of it', async () => {
    const { surface } = openWith(referringIn({ ...readings, numbered: false }, 'title'), {
      referenceContext: stale,
    });
    const view = await surface();
    expect(drawn()).toEqual(['Readings']);
    caretIn(view, 'b2');
    await userEvent.click(screen.getByRole('button', { name: 'Reference' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reference' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Table: Readings' }));
    expect(choices(dialog, 'Show as')).toEqual(['Title', 'Page', 'Above or below']);
    expect(within(dialog).getByText(/It will show/)).toHaveTextContent('It will show: Readings');
  });

  it('shows a number-form reference to a table marked unnumbered as unavailable, drawn apart, and lets the author choose another form (W-N)', async () => {
    const { surface } = openWith(referringIn({ ...readings, numbered: false }, 'number'), {
      referenceContext: stale,
    });
    const view = await surface();
    expect(drawn()).toEqual(['Table not numbered - choose another form']);
    expect(document.querySelectorAll('.ProseMirror .aw-reference-broken')).toHaveLength(1);
    selectFirst(view, 'crossReference');
    await userEvent.click(screen.getByRole('button', { name: 'Reference' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reference' });
    expect(within(dialog).getByRole('radio', { name: 'Table: Readings' })).toBeChecked();
    expect(choices(dialog, 'Show as')).toEqual(['Title', 'Page', 'Above or below']);
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Title' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change' }));
    expect(referencesIn(view)).toMatchObject([{ id: 'x1', display: 'title' }]);
    expect(drawn()).toEqual(['Readings']);
    expect(document.querySelectorAll('.ProseMirror .aw-reference-broken')).toHaveLength(0);
  });

  it('STR-071 trusts the live table over a page that calls it unnumbered after it was numbered again, offering every form', async () => {
    const { surface } = openWith(referringIn(readings, 'number'), {
      referenceContext: {
        targets: [
          {
            target: { kind: 'block' as const, block: 't1' },
            kind: 'table' as const,
            label: null,
            title: 'Readings',
            relative: null,
            unnumbered: true as const,
          },
        ],
      },
    });
    const view = await surface();
    // A number not known yet, as for a table placed since the page last numbered the document.
    expect(drawn()).toEqual(['Table: Readings']);
    caretIn(view, 'b2');
    await userEvent.click(screen.getByRole('button', { name: 'Reference' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reference' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Table: Readings' }));
    expect(choices(dialog, 'Show as')).toEqual([
      'Number',
      'Title',
      'Number and title',
      'Page',
      'Above or below',
    ]);
  });

  it('shows a number-form reference to an unnumbered block equation as unavailable, and opened on it offers a page and a place alone (W-N)', async () => {
    const equation = {
      type: 'equation',
      id: 'e1',
      mathml:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" alttext="x squared"><msup><mi>x</mi><mn>2</mn></msup></math>',
      numbered: false,
    };
    const stored = blocksOf(equation, {
      type: 'paragraph',
      id: 'b1',
      style: 'body',
      content: [
        { type: 'text', value: 'By ', marks: [] },
        {
          type: 'crossReference',
          id: 'x1',
          target: { kind: 'block', block: 'e1' },
          display: 'number',
        },
      ],
    });
    // A page that numbered it before it was marked unnumbered: the live equation is trusted.
    const { surface } = openWith(stored, {
      referenceContext: {
        targets: [
          {
            target: { kind: 'block' as const, block: 'e1' },
            kind: 'equation' as const,
            label: '(3)',
            title: null,
            relative: null,
          },
        ],
      },
    });
    const view = await surface();
    expect(drawn()).toEqual(['Equation not numbered - choose another form']);
    expect(document.querySelectorAll('.ProseMirror .aw-reference-broken')).toHaveLength(1);
    selectFirst(view, 'crossReference');
    await userEvent.click(screen.getByRole('button', { name: 'Reference' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reference' });
    expect(within(dialog).getByRole('radio', { name: 'Equation' })).toBeChecked();
    expect(choices(dialog, 'Show as')).toEqual(['Page', 'Above or below']);
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Above or below' }));
    // What it will show is what the surface draws after the change, not the equation's name.
    expect(within(dialog).getByText(/It will show/)).toHaveTextContent('It will show: above');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change' }));
    expect(referencesIn(view)).toMatchObject([{ id: 'x1', display: 'relative' }]);
    expect(drawn()).toEqual(['above']);
  });

  it('opens on a reference selected whole, and changes its form keeping its identifier', async () => {
    const { surface } = openWith(referring, { referenceContext: inADocument });
    const view = await surface();
    expect(drawn()).toEqual(['Table 1.1']);
    selectFirst(view, 'crossReference');
    await userEvent.click(screen.getByRole('button', { name: 'Reference' }));

    const dialog = await screen.findByRole('dialog', { name: 'Reference' });
    expect(within(dialog).getByRole('radio', { name: 'Table 1.1 Readings' })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: 'Number' })).toBeChecked();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Above or below' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change' }));

    expect(referencesIn(view)).toEqual([
      {
        type: 'crossReference',
        id: 'x1',
        target: { kind: 'block', block: 't1' },
        display: 'relative',
      },
    ]);
    expect(drawn()).toEqual(['below']);
  });

  it('opens on a reference whose target has gone, offering it as it shows, and points it elsewhere', async () => {
    const broken = blocksOf(
      {
        type: 'paragraph',
        id: 'b1',
        style: 'body',
        content: [
          { type: 'text', value: 'See ', marks: [] },
          {
            type: 'crossReference',
            id: 'x1',
            target: { kind: 'block', block: 't9' },
            display: 'title',
          },
        ],
      },
      readings,
    );
    const { surface } = openWith(broken);
    const view = await surface();
    expect(drawn()).toEqual(['Broken reference']);
    selectFirst(view, 'crossReference');
    await userEvent.click(screen.getByRole('button', { name: 'Reference' }));

    const dialog = await screen.findByRole('dialog', { name: 'Reference' });
    expect(choices(dialog, 'Refer to')).toEqual(['Broken reference', 'Table: Readings']);
    expect(within(dialog).getByRole('radio', { name: 'Broken reference' })).toBeChecked();
    // Kept as it is: its own form is offered beside the ones anything has.
    expect(choices(dialog, 'Show as')).toEqual(['Title', 'Page', 'Above or below']);
    expect(within(dialog).getByRole('radio', { name: 'Title' })).toBeChecked();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Table: Readings' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change' }));

    expect(referencesIn(view)).toEqual([
      {
        type: 'crossReference',
        id: 'x1',
        target: { kind: 'block', block: 't1' },
        display: 'title',
      },
    ]);
    expect(drawn()).toEqual(['Table: Readings']);
  });

  it('places nothing on Escape, and puts the focus back on what opened it', async () => {
    const { surface } = openWith(blocksOf(para('b1', 'See the readings.'), readings));
    const view = await surface();
    caretIn(view, 'b1');
    const button = screen.getByRole('button', { name: 'Reference' });
    button.focus();
    await userEvent.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Reference' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(referencesIn(view)).toEqual([]);
    expect(button).toHaveFocus();
  });

  it('places nothing on Cancel, and keeps the keyboard inside the dialog while it is open', async () => {
    const { surface } = openWith(blocksOf(para('b1', 'See the readings.'), readings));
    const view = await surface();
    caretIn(view, 'b1');
    await userEvent.click(screen.getByRole('button', { name: 'Reference' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reference' });
    const close = within(dialog).getByRole('button', { name: 'Close' });

    close.focus();
    await userEvent.tab();
    expect(within(dialog).getByRole('radio', { name: 'Table: Readings' })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(close).toHaveFocus();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(referencesIn(view)).toEqual([]);
  });

  it('says so where nothing in the component can be referred to, and offers nothing to insert', async () => {
    const { surface } = openWith(content('Unbox the printer.'));
    const view = await surface();
    caretIn(view, 'b1');
    await userEvent.click(screen.getByRole('button', { name: 'Reference' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reference' });
    expect(dialog).toHaveTextContent('Nothing in this component can be referred to yet.');
    expect(within(dialog).queryByRole('radio')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Insert' })).toBeNull();
  });

  it('tells two targets of the same name apart by a count, and says each will show as the surface does', async () => {
    const note = (id: string, words: string) => ({
      type: 'footnote',
      id,
      anchor: { kind: 'span' },
      content: [para(`${id}p`, words)],
    });
    const { surface } = openWith(
      blocksOf(
        {
          type: 'paragraph',
          id: 'b1',
          style: 'body',
          content: [
            { type: 'text', value: 'Visited', marks: [] },
            note('f1', 'Once.'),
            { type: 'text', value: ' and seen', marks: [] },
            note('f2', 'Twice.'),
          ],
        },
        para('b2', 'See the notes.'),
      ),
    );
    const view = await surface();
    caretIn(view, 'b2');
    await userEvent.click(screen.getByRole('button', { name: 'Reference' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reference' });

    expect(choices(dialog, 'Refer to')).toEqual(['Footnote', 'Footnote (2)']);
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Footnote (2)' }));
    // The count is the list's alone: the surface draws the reference by its kind.
    expect(within(dialog).getByText(/It will show/)).toHaveTextContent('It will show: Footnote');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Insert' }));

    expect(referencesIn(view)).toMatchObject([{ target: { kind: 'block', block: 'f2' } }]);
    expect(drawn()).toEqual(['Footnote']);
  });

  it("places the reference in a footnote's text while it is open", async () => {
    const { surface } = openWith(
      blocksOf(
        {
          type: 'paragraph',
          id: 'b1',
          style: 'body',
          content: [
            { type: 'text', value: 'Visited', marks: [] },
            {
              type: 'footnote',
              id: 'f1',
              anchor: { kind: 'span' },
              content: [para('fp1', 'See.')],
            },
          ],
        },
        readings,
      ),
    );
    const view = await surface();
    selectFirst(view, 'footnote');
    act(() => {
      const inner = openFootnote(view)!;
      inner.dispatch(
        inner.state.tr.setSelection(
          Selection.fromJSON(inner.state.doc, { type: 'text', anchor: 4, head: 4 }),
        ),
      );
    });
    await userEvent.click(screen.getByRole('button', { name: 'Reference' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reference' });
    // The footnote itself is offered too; the table is chosen.
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Table: Readings' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Insert' }));

    const [block] = fromEditor(view.state.doc).content as unknown as [
      { content: [unknown, { content: { content: unknown[] }[] }] },
    ];
    expect(block.content[1].content[0]!.content).toMatchObject([
      { type: 'text', value: 'See' },
      { type: 'crossReference', target: { kind: 'block', block: 't1' }, display: 'number' },
      { type: 'text', value: '.' },
    ]);
    expect(
      within(screen.getByRole('textbox', { name: 'Footnote text' })).getByText('Table: Readings'),
    ).toBeInTheDocument();
  });

  it('follows the context the page gives it, and keeps it across a version cut', async () => {
    const { client } = service({
      ...answers(referring),
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
    let view: EditorView | undefined;
    const editor = (referenceContext: typeof inADocument | null) => (
      <ComponentEditor
        componentId={COMPONENT}
        client={client}
        principalId={ADA}
        sessionId={SESSION}
        timing={quick}
        onView={(mounted) => (view = mounted)}
        referenceContext={referenceContext}
      />
    );
    const { rerender } = render(editor(null));
    await screen.findByLabelText('Title');
    await waitFor(() => expect(drawn()).toEqual(['Table: Readings']));

    rerender(editor(inADocument));
    expect(drawn()).toEqual(['Table 1.1']);

    act(() => view!.dispatch(view!.state.tr.insertText('Now s', 1, 2)));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save version' })).not.toBeDisabled(),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save version' }));
    await screen.findByText('Version 0.2 saved.');
    expect(drawn()).toEqual(['Table 1.1']);
  });
});

describe('equations in the editor (equations 1)', () => {
  // Every change saves as the author goes; enough answered that no test runs out of them.
  const everySave = Object.fromEntries(
    Array.from({ length: 64 }, (_, at) => [
      `PUT /v1/components/{id}/iterations/{session}/${at + 1}`,
      () => json(200, { sequence: at + 1, lock }),
    ]),
  );
  const answers = (stored: unknown) => ({
    'GET /v1/components/{id}': () => json(200, opened({ content: stored })),
    'POST /v1/components/{id}/lock': () => json(200, { lock }),
    ...everySave,
  });
  const openWith = (stored: unknown) => open(answers(stored), quick, true);

  const NS = 'http://www.w3.org/1998/Math/MathML';
  /** An equation as the reader writes it: its alternative, then anything else, on the root. */
  const stored = (inner: string, alternative: string | null, block = false) =>
    `<math xmlns="${NS}"${alternative === null ? '' : ` alttext="${alternative}"`}${block ? ' display="block"' : ''}>${inner}</math>`;
  const SQUARE = '<msup><mi>x</mi><mn>2</mn></msup>';
  const FRACTION = '<mfrac><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow><mi>c</mi></mfrac>';
  /** What the engine says of FRACTION in English: the same in jsdom as in a browser. */
  const SPOKEN = 'the fraction with numerator a plus b and denominator c';

  const text = (value: string) => ({ type: 'text', value, marks: [] });
  const paragraph = (id: string, ...content: unknown[]) => ({
    type: 'paragraph',
    id,
    style: 'body',
    content,
  });

  /** Every equation the stored document holds, inline or a block, as a save would send it. */
  const equationsIn = (view: EditorView) => {
    const found: Record<string, unknown>[] = [];
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object' && value !== null) {
        if ((value as { type?: unknown }).type === 'equation') {
          found.push(value as Record<string, unknown>);
        }
        Object.values(value).forEach(walk);
      }
    };
    walk(fromEditor(view.state.doc));
    return found;
  };
  /** Selects the first node of that type whole, as a click on it does. */
  const selectFirst = (view: EditorView, type: string) =>
    act(() => {
      let at = -1;
      view.state.doc.descendants((node, pos) => {
        if (at === -1 && node.type.name === type) at = pos;
        return at === -1;
      });
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at)));
    });
  const opens = async () => screen.findByRole('dialog', { name: 'Equation' });
  const latexOf = (dialog: HTMLElement) => within(dialog).getByLabelText('LaTeX');
  const descriptionOf = (dialog: HTMLElement) => within(dialog).getByLabelText('Description');
  /** LaTeX given as an author pastes it, since userEvent reads a brace it types as a key's name. */
  const write = async (dialog: HTMLElement, latex: string) => {
    await userEvent.clear(latexOf(dialog));
    await userEvent.paste(latex);
  };
  /**
   * Waits out every description the dialog has asked for: the engine answers one request after
   * another, so one asked for now is answered only after them. Then React has what they answered.
   */
  const described = () => act(() => describeEquation(stored(SQUARE, null), 'en').then(() => {}));
  const drawnIn = (dialog: HTMLElement) =>
    within(dialog).getByRole('group', { name: 'Preview' }).querySelector('math');

  it('CNT-044 stores the MathML Temml makes of the LaTeX an author types, with the LaTeX as its record', async () => {
    const { surface } = openWith(blocksOf(para('b1', 'Where it grows.')));
    const view = await surface();
    caretIn(view, 'b1');
    const button = screen.getByRole('button', { name: 'Equation' });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    await userEvent.click(button);
    const dialog = await opens();
    await waitFor(() => expect(latexOf(dialog)).toHaveFocus());

    await write(dialog, '\\frac{a+b}{c}');
    // Drawn beneath as it is typed, as the browser draws MathML.
    const drawn = drawnIn(dialog)!;
    expect(drawn.namespaceURI).toBe(NS);
    expect(drawn.querySelector('mfrac')!.namespaceURI).toBe(NS);
    // The first description in this file loads the engine's rules, which can take longer than
    // `waitFor`'s second on CI's runner: wait for the engine itself (issue #242).
    await described();
    expect(descriptionOf(dialog)).toHaveValue(SPOKEN);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Insert' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(equationsIn(view)).toEqual([
      { type: 'equation', mathml: stored(FRACTION, SPOKEN), latex: '\\frac{a+b}{c}' },
    ]);
    expect(view.dom.querySelector('.aw-equation math')!.querySelector('mfrac')).not.toBeNull();
  });

  it("CNT-048 writes the alternative in the component's language, keeps the author's change of it, and leaves it empty and marked in a language it cannot speak", async () => {
    const { surface } = openWith({
      ...blocksOf(para('b1', 'Wo es wächst.'), para('b2', 'Lle mae.')),
      language: 'de-DE',
    });
    const view = await surface();
    caretIn(view, 'b1');
    await userEvent.click(screen.getByRole('button', { name: 'Equation' }));
    let dialog = await opens();
    await write(dialog, '\\frac{a+b}{c}');
    await waitFor(() =>
      expect(descriptionOf(dialog)).toHaveValue('Bruch mit Zähler a plus b und Nenner c'),
    );

    // The author's words are theirs: a change of LaTeX afterwards leaves them as they are.
    await userEvent.clear(descriptionOf(dialog));
    await userEvent.type(descriptionOf(dialog), 'a plus b geteilt durch c');
    await write(dialog, '\\frac{a+b}{c} + 1');
    await described();
    expect(descriptionOf(dialog)).toHaveValue('a plus b geteilt durch c');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Insert' }));
    expect(equationsIn(view).map((each) => equationAlternative(each.mathml as string))).toEqual([
      'a plus b geteilt durch c',
    ]);

    // In a language the engine does not speak the field is left empty, and says why.
    fireEvent.change(await languageField(), { target: { value: 'cy' } });
    caretIn(view, 'b2');
    await userEvent.click(screen.getByRole('button', { name: 'Equation' }));
    dialog = await opens();
    await write(dialog, 'x^2');
    await described();
    const unspoken = 'No description can be written for you in Welsh. Write one yourself.';
    expect(descriptionOf(dialog)).toHaveValue('');
    expect(descriptionOf(dialog)).toHaveAccessibleDescription(expect.stringContaining(unspoken));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Insert' }));

    const [, second] = equationsIn(view);
    expect(second).toEqual({ type: 'equation', mathml: stored(SQUARE, null), latex: 'x^2' });
    // And marked where it stands, in words a screen reader hears.
    const holders = view.dom.querySelectorAll('.aw-equation');
    expect(holders[1]).toHaveClass('aw-equation-undescribed');
    expect(holders[1]).toHaveTextContent('No description');
  });

  it('CNT-080 draws an equation as native MathML carrying its alternative, reached by the keyboard and opened by Enter', async () => {
    const { surface } = openWith(
      blocksOf(
        paragraph(
          'b1',
          { type: 'equation', mathml: stored(SQUARE, 'x squared'), latex: 'x^2' },
          text(' grows.'),
        ),
      ),
    );
    const view = await surface();
    const math = view.dom.querySelector('.aw-equation math')!;
    expect(math.namespaceURI).toBe(NS);
    expect(math.getAttribute('alttext')).toBe('x squared');
    expect(math.getAttribute('aria-label')).toBe('x squared');

    // Tab reaches the surface, the caret stands before the equation, and the arrow selects it.
    screen.getByLabelText('Title').focus();
    for (let stops = 0; stops < 40 && document.activeElement !== view.dom; stops += 1) {
      await userEvent.tab();
    }
    expect(view.dom).toHaveFocus();
    // As a browser sends it, with its key code: ProseMirror's own arrow handling, which selects an
    // atom whole, reads the code, and userEvent's events carry none.
    fireEvent.keyDown(view.dom, { key: 'ArrowRight', keyCode: 39 });
    expect(view.dom.querySelector('.aw-equation')).toHaveClass('ProseMirror-selectednode');
    await userEvent.keyboard('{Enter}');

    const dialog = await opens();
    expect(latexOf(dialog)).toHaveValue('x^2');
    expect(descriptionOf(dialog)).toHaveValue('x squared');
    expect(within(dialog).getByRole('button', { name: 'Change' })).toBeInTheDocument();
    expect(equationsIn(view)).toHaveLength(1);
  });

  it('opens on a block equation selected whole and changes it, keeping its identifier and the words the author gave it', async () => {
    const { surface } = openWith(
      blocksOf(
        para('b1', 'Growth:'),
        {
          type: 'equation',
          id: 'e1',
          mathml: stored(SQUARE, 'x squared', true),
          latex: 'x^2',
          numbered: false,
        },
        para('b2', 'As shown.'),
      ),
    );
    const view = await surface();
    selectFirst(view, 'equationBlock');
    await userEvent.click(screen.getByRole('button', { name: 'Equation' }));
    const dialog = await opens();
    expect(latexOf(dialog)).toHaveValue('x^2');
    // Its kind is its own: changing an equation never moves it.
    expect(within(dialog).queryByRole('radio')).toBeNull();
    const numbered = within(dialog).getByRole('checkbox', { name: 'Numbered' });
    expect(numbered).not.toBeChecked();
    await userEvent.click(numbered);
    await write(dialog, 'x^3');
    await described();
    // Not what the engine would say of x squared here, so the author's, and kept - with a word.
    expect(descriptionOf(dialog)).toHaveValue('x squared');
    expect(dialog).toHaveTextContent(
      'The description is yours, so it was not written again. Generate again writes it for the equation as it is now.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change' }));

    expect(equationsIn(view)).toEqual([
      {
        type: 'equation',
        id: 'e1',
        mathml: stored('<msup><mi>x</mi><mn>3</mn></msup>', 'x squared', true),
        latex: 'x^3',
        numbered: true,
      },
    ]);
  });

  it("writes the description again for a changed equation where it was the engine's own, and on Generate again where it was the author's", async () => {
    const { surface } = openWith(
      blocksOf(
        paragraph(
          'b1',
          { type: 'equation', mathml: stored(FRACTION, SPOKEN), latex: '\\frac{a+b}{c}' },
          { type: 'equation', mathml: stored(FRACTION, 'a over c'), latex: '\\frac{a+b}{c}' },
        ),
      ),
    );
    const view = await surface();
    selectFirst(view, 'equation');
    await userEvent.click(screen.getByRole('button', { name: 'Equation' }));
    let dialog = await opens();
    // Never written on opening: what is there is what was stored.
    expect(descriptionOf(dialog)).toHaveValue(SPOKEN);
    await write(dialog, '\\frac{a+b}{d}');
    await waitFor(() =>
      expect(descriptionOf(dialog)).toHaveValue(
        'the fraction with numerator a plus b and denominator d',
      ),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    act(() => view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 2))));
    await userEvent.click(screen.getByRole('button', { name: 'Equation' }));
    dialog = await opens();
    await write(dialog, '\\frac{a+b}{d}');
    await described();
    expect(descriptionOf(dialog)).toHaveValue('a over c');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Generate again' }));
    await waitFor(() =>
      expect(descriptionOf(dialog)).toHaveValue(
        'the fraction with numerator a plus b and denominator d',
      ),
    );
  });

  it('writes no description on opening, even for an equation that has none', async () => {
    const { surface } = openWith(
      blocksOf(
        paragraph('b1', {
          type: 'equation',
          mathml: stored(FRACTION, null),
          latex: '\\frac{a+b}{c}',
        }),
      ),
    );
    const view = await surface();
    selectFirst(view, 'equation');
    await userEvent.click(screen.getByRole('button', { name: 'Equation' }));
    const dialog = await opens();
    await described();
    expect(descriptionOf(dialog)).toHaveValue('');
    // Until the author asks.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Generate again' }));
    await waitFor(() => expect(descriptionOf(dialog)).toHaveValue(SPOKEN));
  });

  it('opens an equation stored without LaTeX with the field empty, saying typing replaces it, and keeps it as it is otherwise', async () => {
    const { surface } = openWith(
      blocksOf(paragraph('b1', { type: 'equation', mathml: stored(SQUARE, null) }, text('.'))),
    );
    const view = await surface();
    selectFirst(view, 'equation');
    await userEvent.click(screen.getByRole('button', { name: 'Equation' }));
    const dialog = await opens();
    expect(latexOf(dialog)).toHaveValue('');
    expect(latexOf(dialog)).toHaveAccessibleDescription(
      expect.stringContaining(
        'This equation was stored without its LaTeX. Typing LaTeX here replaces it.',
      ),
    );
    expect(drawnIn(dialog)!.querySelector('msup')).not.toBeNull();
    await userEvent.type(descriptionOf(dialog), 'x squared');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change' }));

    expect(equationsIn(view)).toEqual([{ type: 'equation', mathml: stored(SQUARE, 'x squared') }]);
  });

  it('offers a block where one may stand, placed numbered, and only an inline one in an open footnote', async () => {
    const { surface } = openWith(
      blocksOf(
        paragraph('b1', text('Visited'), {
          type: 'footnote',
          id: 'f1',
          anchor: { kind: 'span' },
          content: [para('fp1', 'See.')],
        }),
        para('b2', 'Growth:'),
      ),
    );
    const view = await surface();
    caretIn(view, 'b2');
    await userEvent.click(screen.getByRole('button', { name: 'Equation' }));
    let dialog = await opens();
    expect(within(dialog).getByRole('radio', { name: 'Inline' })).toBeChecked();
    expect(within(dialog).queryByRole('checkbox', { name: 'Numbered' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Block' }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Numbered' }));
    await write(dialog, 'E = mc^2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Insert' }));
    // Placed once its description is written, which Insert waits for.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(equationsIn(view)).toMatchObject([
      { type: 'equation', id: expect.any(String), latex: 'E = mc^2', numbered: true },
    ]);
    expect(view.dom.querySelector('.aw-equation-block .aw-equation-number')).not.toBeNull();

    selectFirst(view, 'footnote');
    act(() => {
      const inner = openFootnote(view)!;
      inner.dispatch(
        inner.state.tr.setSelection(
          Selection.fromJSON(inner.state.doc, { type: 'text', anchor: 4, head: 4 }),
        ),
      );
    });
    await userEvent.click(screen.getByRole('button', { name: 'Equation' }));
    dialog = await opens();
    expect(within(dialog).queryByRole('radio')).toBeNull();
    await write(dialog, 'x^2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Insert' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const [block] = fromEditor(view.state.doc).content as unknown as [
      { content: [unknown, { content: { content: unknown[] }[] }] },
    ];
    expect(block.content[1].content[0]!.content).toMatchObject([
      { type: 'text', value: 'See' },
      { type: 'equation', latex: 'x^2' },
      { type: 'text', value: '.' },
    ]);
  });

  it('waits for a description still being written before it places the equation, by Insert or by Ctrl and Enter', async () => {
    // The final whole-branch review's M2: an equation inserted the moment its LaTeX was typed was
    // placed with no description, and the words the engine wrote a moment later were thrown away.
    const { surface } = openWith(blocksOf(para('b1', 'Where it grows.')));
    const view = await surface();
    caretIn(view, 'b1');
    await userEvent.click(screen.getByRole('button', { name: 'Equation' }));
    let dialog = await opens();
    fireEvent.change(latexOf(dialog), { target: { value: '\\frac{a+b}{c}' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Insert' }));
    // Not yet placed, and the button says why.
    expect(
      within(dialog).getByRole('button', { name: 'Writing the description' }),
    ).toBeInTheDocument();
    expect(equationsIn(view)).toEqual([]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(equationsIn(view)).toEqual([
      { type: 'equation', mathml: stored(FRACTION, SPOKEN), latex: '\\frac{a+b}{c}' },
    ]);

    caretIn(view, 'b1');
    await userEvent.click(screen.getByRole('button', { name: 'Equation' }));
    dialog = await opens();
    fireEvent.change(latexOf(dialog), { target: { value: '\\frac{a+b}{c}' } });
    fireEvent.keyDown(latexOf(dialog), { key: 'Enter', ctrlKey: true });
    expect(equationsIn(view)).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(equationsIn(view).map((each) => equationAlternative(each.mathml as string))).toEqual([
      SPOKEN,
      SPOKEN,
    ]);
  });

  it('says what is wrong with the LaTeX beneath it, draws nothing, and places nothing', async () => {
    const { surface } = openWith(blocksOf(para('b1', 'Where it grows.')));
    const view = await surface();
    caretIn(view, 'b1');
    await userEvent.click(screen.getByRole('button', { name: 'Equation' }));
    const dialog = await opens();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Insert' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Type the equation in LaTeX.');

    await write(dialog, '\\cancel{x}');
    expect(latexOf(dialog)).toHaveAttribute('aria-invalid', 'true');
    expect(latexOf(dialog)).toHaveAccessibleDescription(
      expect.stringContaining('An equation here cannot keep \\cancel. Write it another way.'),
    );
    expect(drawnIn(dialog)).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Insert' }));
    // Back in the field whose words say what to put right.
    await waitFor(() => expect(latexOf(dialog)).toHaveFocus());
    expect(equationsIn(view)).toEqual([]);
  });

  it('says an equation that draws nothing is not placed, and places nothing', async () => {
    // The final review of equations 2, M1: a publication would tag nothing for it, and its words
    // would be lost.
    const { surface } = openWith(blocksOf(para('b1', 'Where it grows.')));
    const view = await surface();
    caretIn(view, 'b1');
    await userEvent.click(screen.getByRole('button', { name: 'Equation' }));
    const dialog = await opens();
    await write(dialog, '\\,');
    expect(latexOf(dialog)).toHaveAttribute('aria-invalid', 'true');
    expect(latexOf(dialog)).toHaveAccessibleDescription(
      expect.stringContaining(
        'An equation has to show something: this one draws nothing. Write what it is to show.',
      ),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Insert' }));
    await waitFor(() => expect(latexOf(dialog)).toHaveFocus());
    expect(equationsIn(view)).toEqual([]);
  });

  it('places nothing on Escape or Cancel, keeps the keyboard inside, and puts the focus back on what opened it', async () => {
    const { surface } = openWith(blocksOf(para('b1', 'Where it grows.')));
    const view = await surface();
    caretIn(view, 'b1');
    const button = screen.getByRole('button', { name: 'Equation' });
    button.focus();
    await userEvent.keyboard('{Enter}');
    let dialog = await opens();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // The same drawing as the button that opened it.
    expect(
      within(dialog).getByRole('heading', { name: 'Equation' }).querySelector('[data-icon]'),
    ).toHaveAttribute('data-icon', 'Equation');
    await write(dialog, 'x^2');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveFocus();

    await userEvent.click(button);
    dialog = await opens();
    const close = within(dialog).getByRole('button', { name: 'Close' });
    close.focus();
    await userEvent.tab();
    await waitFor(() => expect(latexOf(dialog)).toHaveFocus());
    await userEvent.tab({ shift: true });
    expect(close).toHaveFocus();
    await write(dialog, 'x^2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(equationsIn(view)).toEqual([]);
  });

  it('opens from the keyboard alone, with Ctrl, Shift and E', async () => {
    const { surface } = openWith(blocksOf(para('b1', 'Where it grows.')));
    const view = await surface();
    await screen.findByRole('button', { name: 'Equation' });
    caretIn(view, 'b1');
    fireEvent.keyDown(view.dom, { key: 'E', keyCode: 69, ctrlKey: true, shiftKey: true });
    expect(latexOf(await opens())).toHaveFocus();
  });
});

describe('the symbol palette (W14.7)', () => {
  // Every change saves as the author goes; enough answered that no test runs out of them.
  const everySave = Object.fromEntries(
    Array.from({ length: 16 }, (_, at) => [
      `PUT /v1/components/{id}/iterations/{session}/${at + 1}`,
      () => json(200, { sequence: at + 1, lock }),
    ]),
  );
  const openWith = (
    stored: unknown,
    overrides: Record<string, unknown> = {},
    presentation?: unknown,
  ) =>
    open(
      {
        'GET /v1/components/{id}': () => json(200, opened({ content: stored, ...overrides })),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        ...everySave,
      },
      quick,
      true,
      {},
      presentation,
    );
  const opens = () => screen.findByRole('dialog', { name: 'Symbols' });
  const symbol = (dialog: HTMLElement, name: string) =>
    within(dialog).getByRole('button', { name });
  const ALPHA = String.fromCodePoint(0x3b1);
  /** Every paragraph's text, as a save would send it. */
  const textsOf = (view: EditorView) =>
    fromEditor(view.state.doc).content.map((block) =>
      block.type === 'paragraph'
        ? block.content.map((run) => (run.type === 'text' ? run.value : '')).join('')
        : '',
    );
  /** The caret this many characters into the first paragraph. */
  const caretAt = (view: EditorView, offset: number) => selectText(view, 1 + offset, 1 + offset);

  it('CNT-057 offers mathematical, Greek, and scientific and technical symbols, inserts one at the cursor, and gives the focus back', async () => {
    const { surface } = openWith(blocksOf(para('b1', 'Angle  is small.')));
    const view = await surface();
    caretAt(view, 6);
    const button = screen.getByRole('button', { name: 'Symbols' });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(button).toHaveAttribute('aria-disabled', 'false');
    await userEvent.click(button);
    const dialog = await opens();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // The three groups, each a grid named by its heading.
    expect(within(dialog).getAllByRole('grid')).toHaveLength(3);
    for (const name of ['Mathematical', 'Greek', 'Scientific and technical']) {
      expect(within(dialog).getByRole('grid', { name })).toBeInTheDocument();
    }
    expect(
      within(within(dialog).getByRole('grid', { name: 'Mathematical' })).getByRole('button', {
        name: 'N-ary summation',
      }),
    ).toHaveTextContent(String.fromCodePoint(0x2211));
    expect(
      within(within(dialog).getByRole('grid', { name: 'Scientific and technical' })).getByRole(
        'button',
        { name: 'Degree sign' },
      ),
    ).toBeInTheDocument();
    // The first of them holds the focus as it opens.
    expect(symbol(dialog, 'Plus-minus sign')).toHaveFocus();
    // With no theme to ask, every one is offered: the surface's own check marks any its face lacks.
    expect(
      within(dialog)
        .getAllByRole('button')
        .filter((each) => each.getAttribute('aria-disabled') === 'true'),
    ).toEqual([]);
    expect(within(dialog).queryByText(/are dimmed/)).toBeNull();

    await userEvent.click(symbol(dialog, 'Greek small letter alpha'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(textsOf(view)).toEqual([`Angle ${ALPHA} is small.`]);
    // Back on the surface, after the character, where typing it would have left the caret.
    await waitFor(() => expect(view.hasFocus()).toBe(true));
    expect(view.state.selection.from).toBe(1 + 7);
  });

  it('dims what the typeface at the cursor lacks, pointing to an equation, and inserts only what it has', async () => {
    const { surface } = openWith(
      blocksOf(para('b1', 'Angle  is small.'), {
        type: 'preformatted',
        id: 'p1',
        text: 'x = 1',
      }),
      {},
      DEFAULT_PRESENTATION,
    );
    const view = await surface();
    caretAt(view, 6);
    await userEvent.click(screen.getByRole('button', { name: 'Symbols' }));
    let dialog = await opens();
    // For all is not in the default serif, which sets running text: it stays in its place,
    // disabled, and says why - once the presentation has arrived to say which face that is.
    const forAll = await within(dialog).findByRole('button', {
      name: 'For all, not in Liberation Serif; use an equation',
    });
    // Said once, above the grids.
    expect(
      within(dialog).getAllByText(
        'Symbols the typeface here does not have are dimmed; set them in an equation.',
      ),
    ).toHaveLength(1);
    expect(forAll).toHaveAttribute('aria-disabled', 'true');
    expect(forAll).toHaveTextContent(String.fromCodePoint(0x2200));
    // Choosing it inserts nothing, and leaves the palette open for another.
    await userEvent.click(forAll);
    expect(screen.getByRole('dialog', { name: 'Symbols' })).toBeInTheDocument();
    expect(textsOf(view)).toEqual(['Angle  is small.', '']);
    // It can still be reached from the keyboard, so the grid stays one grid: and Enter does nothing.
    forAll.focus();
    await userEvent.keyboard('{Enter}');
    expect(textsOf(view)).toEqual(['Angle  is small.', '']);
    await userEvent.keyboard('{ArrowRight}');
    expect(
      within(dialog).getByRole('button', {
        name: 'There exists, not in Liberation Serif; use an equation',
      }),
    ).toHaveFocus();

    // What the serif has inserts as ever.
    const alpha = symbol(dialog, 'Greek small letter alpha');
    expect(alpha).not.toHaveAttribute('aria-disabled');
    await userEvent.click(alpha);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(textsOf(view)[0]).toBe(`Angle ${ALPHA} is small.`);

    // In preformatted text the question is asked of the face that sets code.
    let code = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'preformatted') code = pos;
    });
    selectText(view, code + 2, code + 2);
    await userEvent.click(screen.getByRole('button', { name: 'Symbols' }));
    dialog = await opens();
    expect(
      within(dialog).getByRole('button', {
        name: 'For all, not in Liberation Mono; use an equation',
      }),
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('moves through a group by the arrow keys, Home and End, and on to the next group by Tab', async () => {
    const { surface } = openWith(blocksOf(para('b1', 'Angle  is small.')));
    const view = await surface();
    await screen.findByRole('button', { name: 'Symbols' });
    caretAt(view, 6);
    // From the keyboard alone: Ctrl, Shift and M.
    fireEvent.keyDown(view.dom, { key: 'M', keyCode: 77, ctrlKey: true, shiftKey: true });
    const dialog = await opens();
    expect(symbol(dialog, 'Plus-minus sign')).toHaveFocus();
    // One tab stop in each group, which the arrows move.
    const grids = within(dialog).getAllByRole('grid');
    for (const grid of grids) {
      expect(
        within(grid)
          .getAllByRole('button')
          .filter((each) => each.tabIndex === 0),
      ).toHaveLength(1);
    }

    await userEvent.keyboard('{ArrowRight}');
    expect(symbol(dialog, 'Minus-or-plus sign')).toHaveFocus();
    // Down a row of twelve, and up again.
    await userEvent.keyboard('{ArrowDown}');
    expect(symbol(dialog, 'Tilde operator')).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(symbol(dialog, 'Minus-or-plus sign')).toHaveFocus();
    // Nothing before the first: the left arrow stays there, as it does at the top.
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}{ArrowUp}');
    expect(symbol(dialog, 'Plus-minus sign')).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(symbol(dialog, 'Vulgar fraction three quarters')).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(symbol(dialog, 'Plus-minus sign')).toHaveFocus();

    // Tab reaches the next group, where its own stop is, then Close, then round again.
    await userEvent.tab();
    expect(symbol(dialog, 'Greek small letter alpha')).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(symbol(dialog, 'Greek capital letter omega')).toHaveFocus();
    await userEvent.tab();
    expect(symbol(dialog, 'Degree sign')).toHaveFocus();
    await userEvent.tab();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
    await userEvent.tab();
    expect(symbol(dialog, 'Plus-minus sign')).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(symbol(dialog, 'Degree sign')).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(symbol(dialog, 'Greek capital letter omega')).toHaveFocus();

    // And Enter inserts the one that holds the focus.
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(textsOf(view)).toEqual([`Angle ${String.fromCodePoint(0x3a9)} is small.`]);
    await waitFor(() => expect(view.hasFocus()).toBe(true));
  });

  it('inserts nothing on Escape or Close, and gives the focus back to the surface', async () => {
    const { surface } = openWith(blocksOf(para('b1', 'Angle  is small.')));
    const view = await surface();
    caretAt(view, 6);
    const button = screen.getByRole('button', { name: 'Symbols' });
    // Opened from the button by the keyboard, so the focus is on the button as it opens.
    button.focus();
    await userEvent.keyboard('{Enter}');
    let dialog = await opens();
    // The same drawing as the button that opened it.
    expect(
      within(dialog).getByRole('heading', { name: 'Symbols' }).querySelector('[data-icon]'),
    ).toHaveAttribute('data-icon', 'Symbols');
    await userEvent.keyboard('{ArrowRight}{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(view.hasFocus()).toBe(true));
    expect(textsOf(view)).toEqual(['Angle  is small.']);

    await userEvent.click(button);
    dialog = await opens();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(view.hasFocus()).toBe(true));
    expect(textsOf(view)).toEqual(['Angle  is small.']);
  });

  it('inserts into a footnote while its text is open, and gives the focus back there', async () => {
    const { surface } = openWith(
      blocksOf({
        type: 'paragraph',
        id: 'b1',
        style: 'body',
        content: [
          { type: 'text', value: 'Visited', marks: [] },
          {
            type: 'footnote',
            id: 'f1',
            anchor: { kind: 'span' },
            content: [para('fp1', 'Once')],
          },
        ],
      }),
    );
    const view = await surface();
    let at = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'footnote') at = pos;
    });
    act(() => {
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at)));
    });
    const note = await waitFor(() => {
      const opened = openFootnote(view);
      if (opened === null) throw new Error('no footnote open');
      return opened;
    });
    act(() => {
      note.dispatch(note.state.tr.setSelection(Selection.atStart(note.state.doc)));
    });
    await userEvent.click(screen.getByRole('button', { name: 'Symbols' }));
    await userEvent.click(symbol(await opens(), 'Greek small letter alpha'));
    expect(screen.queryByRole('dialog')).toBeNull();
    const [block] = fromEditor(view.state.doc).content;
    expect(block).toMatchObject({
      content: [
        { value: 'Visited' },
        { type: 'footnote', content: [{ content: [{ value: `${ALPHA}Once` }] }] },
      ],
    });
    await waitFor(() => expect(note.hasFocus()).toBe(true));
  });

  it('is unavailable to a reader, as the other insert buttons are, and opens nothing', async () => {
    const { surface } = openWith(blocksOf(para('b1', 'Angle  is small.')), { mayEdit: false });
    await surface();
    const button = screen.getByRole('button', { name: 'Symbols' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Equation' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await userEvent.click(button);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
