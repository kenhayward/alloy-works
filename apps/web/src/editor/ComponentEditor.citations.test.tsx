import { fromEditor, NodeSelection, type EditorView } from '@alloy-works/editor';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shimRangeMeasurement } from '../test/range.js';
import {
  open,
  json,
  lock,
  opened,
  quick,
  caretIn,
  blocksOf,
  para,
} from './test/componentEditor.js';

shimRangeMeasurement();

afterEach(() => vi.restoreAllMocks());

const MARLOW = '0b0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9c01';
const PENHALLOW = '0b0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9c02';
const WITHHELD = '0b0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9c03';
const version = { id: '0b0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9cf1', number: '0.1' };
const summary = (id: string, key: string, family: string, title: string, year: number) => ({
  id,
  key,
  csl: { type: 'book', title, author: [{ family }], issued: { 'date-parts': [[year]] } },
  version,
  changedAt: '2026-10-22T09:00:00.000Z',
});

/** The in-text form the service renders each entry as, Harvard's; the withheld one none. */
const FORMS: Record<string, string> = {
  [MARLOW]: '(Marlow, 2020)',
  [PENHALLOW]: '(Penhallow, 2018)',
};

describe('citing in the editor (the CI plan, CId)', () => {
  const everySave = Object.fromEntries(
    Array.from({ length: 64 }, (_, at) => [
      `PUT /v1/components/{id}/iterations/{session}/${at + 1}`,
      () => json(200, { sequence: at + 1, lock }),
    ]),
  );
  const answers = (stored: unknown) => ({
    'GET /v1/components/{id}': () => json(200, opened({ content: stored })),
    'POST /v1/components/{id}/lock': () => json(200, { lock }),
    'GET /v1/spaces/s1/bibliography-entries': () =>
      json(200, {
        items: [
          summary(MARLOW, 'marlow2020', 'Marlow', 'Sediment and its movement', 2020),
          summary(PENHALLOW, 'penhallow2018', 'Penhallow', 'Salt marshes', 2018),
        ],
        next: null,
        total: 2,
      }),
    'POST /v1/components/{id}/citations/preview': (body: unknown) => {
      const { citations } = body as { citations: { entry: string; locator?: string }[] };
      return json(200, {
        forms: citations.map(({ entry, locator }) =>
          FORMS[entry] === undefined
            ? null
            : locator === undefined
              ? FORMS[entry]
              : FORMS[entry]!.replace(')', `, ${locator})`),
        ),
      });
    },
    ...everySave,
  });

  /** Every citation the stored document holds, as a save would send it. */
  const citationsIn = (view: EditorView) => {
    const found: Record<string, unknown>[] = [];
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object' && value !== null) {
        if ((value as { type?: unknown }).type === 'citation') {
          found.push(value as Record<string, unknown>);
        }
        Object.values(value).forEach(walk);
      }
    };
    walk(fromEditor(view.state.doc));
    return found;
  };
  /** What each citation on the surface shows, in order. */
  const drawn = () =>
    [...document.querySelectorAll('.ProseMirror [data-citation]')].map((each) => each.textContent);
  const cite = (entry: string, locator?: string) => ({
    type: 'citation',
    entry,
    ...(locator === undefined ? {} : { locator }),
  });
  const citing = (...inlines: unknown[]) =>
    blocksOf({
      type: 'paragraph',
      id: 'b1',
      style: 'body',
      content: [{ type: 'text', value: 'Sediment moves ', marks: [] }, ...inlines],
    });

  it("opens a component holding citations for editing, each drawn as the service renders it, and one whose entry the reader cannot read as 'Citation unavailable'", async () => {
    const { surface, asked } = open(answers(citing(cite(MARLOW, 'p. 4'), cite(WITHHELD))), quick);
    await surface();
    expect(screen.queryByText(/shown for reading only/)).toBeNull();
    await waitFor(() => expect(drawn()).toEqual(['(Marlow, 2020, p. 4)', 'Citation unavailable']));
    expect(document.querySelector('.aw-citation-unavailable')).toHaveTextContent(
      'Citation unavailable',
    );
    expect(asked.find((each) => each.route.endsWith('/citations/preview'))?.body).toEqual({
      citations: [{ entry: MARLOW, locator: 'p. 4' }, { entry: WITHHELD }],
    });
  });

  it("draws every citation as 'Citation unavailable' where the preview fails", async () => {
    const { surface } = open(
      {
        ...answers(citing(cite(MARLOW), cite(PENHALLOW, 'p. 2'))),
        'POST /v1/components/{id}/citations/preview': () => json(500, { code: 'internal' }),
      },
      quick,
    );
    await surface();
    await waitFor(() => expect(drawn()).toEqual(['Citation unavailable', 'Citation unavailable']));
  });

  it("asks at most 500 citations at a time, and none whose entry is longer than an id, drawn 'Citation unavailable'", async () => {
    const overlong = 'x'.repeat(201);
    const many = Array.from({ length: 501 }, (_, at) => cite(MARLOW, `p. ${at + 1}`));
    const { surface, asked } = open(answers(citing(cite(overlong), ...many)), quick);
    await surface();
    await waitFor(() => expect(drawn()[501]).toBe('(Marlow, 2020, p. 501)'));
    expect(drawn()[0]).toBe('Citation unavailable');
    const sent = asked
      .filter((each) => each.route.endsWith('/citations/preview'))
      .map((each) => (each.body as { citations: { entry: string }[] }).citations);
    expect(sent.map((each) => each.length)).toEqual([500, 1]);
    expect(sent.flat().some((each) => each.entry === overlong)).toBe(false);
  });

  it('cites an entry from the Cite button, found by its author, with a locator, and draws its form', async () => {
    const { surface } = open(answers(blocksOf(para('b1', 'Sediment moves.'))), quick);
    const view = await surface();
    caretIn(view, 'b1');
    const button = screen.getByRole('button', { name: 'Cite' });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    await userEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Cite' });
    await userEvent.type(
      await within(dialog).findByRole('searchbox', { name: 'Find an entry' }),
      'penhallow',
    );
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Locator/ }), 'p. 9');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Insert' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(citationsIn(view)).toEqual([{ type: 'citation', entry: PENHALLOW, locator: 'p. 9' }]);
    await waitFor(() => expect(drawn()).toEqual(['(Penhallow, 2018, p. 9)']));
  });

  it('opens the dialog from the keyboard alone, with Ctrl, Shift and 2, and changes the citation selected', async () => {
    const { surface } = open(answers(citing(cite(MARLOW))), quick);
    const view = await surface();
    await screen.findByRole('button', { name: 'Cite' });
    act(() => {
      let at = -1;
      view.state.doc.descendants((node, pos) => {
        if (at === -1 && node.type.name === 'citation') at = pos;
        return at === -1;
      });
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at)));
    });
    fireEvent.keyDown(view.dom, { key: '2', code: 'Digit2', ctrlKey: true, shiftKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Cite' });
    expect(await within(dialog).findByRole('radio', { name: /marlow2020/ })).toBeChecked();
    await userEvent.click(within(dialog).getByRole('radio', { name: /penhallow2018/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change' }));
    expect(citationsIn(view)).toEqual([{ type: 'citation', entry: PENHALLOW }]);
    // And removed as any atom selected whole is.
    act(() => view.dispatch(view.state.tr.deleteSelection()));
    expect(citationsIn(view)).toEqual([]);
  });

  it("STR-069 offers the space's entries in the Reference dialog, and places a cross-reference to one", async () => {
    const { surface } = open(answers(blocksOf(para('b1', 'See the source.'))), quick);
    const view = await surface();
    caretIn(view, 'b1');
    await userEvent.click(screen.getByRole('button', { name: 'Reference' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reference' });
    const entry = within(dialog).getByRole('radio', { name: /Entry marlow2020/ });
    await userEvent.click(entry);
    // Rendered for this component alone: the document numbers and tells apart its citations.
    await waitFor(() =>
      expect(within(dialog).getByText(/It will show/)).toHaveTextContent(
        'It will show: Its in-text form, as the document sets it at publish',
      ),
    );
    // An entry shows its style's in-text form alone, so no form is asked.
    expect(within(dialog).queryByRole('group', { name: 'Show as' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Insert' }));
    const [paragraph] = fromEditor(view.state.doc).content as unknown as [{ content: unknown[] }];
    expect(
      paragraph.content.find((each) => (each as { type: string }).type === 'crossReference'),
    ).toMatchObject({
      type: 'crossReference',
      target: { kind: 'entry', entry: MARLOW },
      display: 'number',
    });
    await waitFor(() =>
      expect(document.querySelector('.ProseMirror [data-reference]')).toHaveTextContent(
        '(Marlow, 2020)',
      ),
    );
  });
});
