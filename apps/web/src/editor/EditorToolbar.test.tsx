import { parseContentDocument, type Mark } from '@alloy-works/domain';
import {
  createEditorState,
  fromEditor,
  mountEditor,
  Selection,
  toEditor,
  type EditorView,
  type Transaction,
} from '@alloy-works/editor';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EditorToolbar, type EditorToolbarProps } from './EditorToolbar.js';

/**
 * jsdom has no layout, and a `Range` there has neither of the two methods ProseMirror calls when it
 * scrolls the selection into view - which every mark step asks it to do, and which it only does
 * while the surface has the focus. Both answer nothing rather than pretending to measure, which
 * leaves the scroll a no-op instead of an uncaught `TypeError` from inside a click. Each test file
 * gets its own jsdom, so this reaches no other suite.
 */
const NOTHING = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 };
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => NOTHING as DOMRect;

/** One paragraph of stored content, as the service answers it and `toEditor` opens it. */
const stored = (...inlines: unknown[]) => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: [{ type: 'paragraph', id: 'b1', style: 'body', content: inlines }],
});

const run = (value: string, ...marks: Mark[]) => ({ type: 'text', value, marks });

/** The paragraph's runs as the stored model spells them, which is what a save would send. */
const runsOf = (view: EditorView) => {
  const [block] = fromEditor(view.state.doc).content;
  return block?.type === 'paragraph' ? block.content : [];
};

const LABELS = [
  'Strong',
  'Emphasis',
  'Underline',
  'Subscript',
  'Superscript',
  'Inline code',
  'Quoted phrase',
  'Link',
  'Language',
];

/** The seven that apply a mark where they stand; the other two open a dialog first. */
const TOGGLES = LABELS.slice(0, 7);

interface ToolbarOptions {
  readonly document?: unknown;
  readonly enabled?: boolean;
  /** What the prompt resolves with: null is the author cancelling. */
  readonly answer?: Record<string, unknown> | null;
  /** The whole prompt, where a test needs one that hangs or throws rather than one that answers. */
  readonly asks?: EditorToolbarProps['prompt'];
  /** A cursor at this position before the toolbar renders. */
  readonly caret?: number;
  /** A selection over this range before the toolbar renders. */
  readonly range?: readonly [number, number];
  /** False mounts no view at all, which is what the first render of a page holds. */
  readonly mounted?: boolean;
}

let place: HTMLDivElement | null = null;
let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
  place?.remove();
  place = null;
  vi.restoreAllMocks();
});

/**
 * The toolbar over a real view, with the view built and mounted **outside React** (pre-flight F17).
 * An effect that mounted it would mount two under `<StrictMode>`, and a test that then waited for the
 * editing surface would be waiting for a React render of the same component - the race this
 * repository has lost time to twice. Nothing here owns the view but the test, which takes it down.
 *
 * Marks and blocks draw their identifiers from sequences of their own, as `marks.test.ts` does, so
 * what a button minted is told apart by the name it was given rather than by where it landed.
 */
function renderToolbar(options: ToolbarOptions = {}) {
  const {
    document: content = stored(run('Unbox the printer.')),
    enabled = true,
    answer = null,
    asks,
    caret,
    range,
    mounted = true,
  } = options;
  const dispatched: Transaction[] = [];
  const prompt = vi.fn(asks ?? (() => Promise.resolve(answer)));
  const onRefused = vi.fn();
  let marks = 0;
  const newIdentifier = () => `m${(marks += 1)}`;
  if (mounted) {
    const opened = toEditor(parseContentDocument(content));
    if (!opened.editable) throw new Error('the fixture must open for editing');
    let blocks = 0;
    // `Selection.fromJSON` is the only route to a range selection through the editor package's own
    // exports, which are what a renderer may import: `TextSelection` is not among them.
    const selection = range
      ? Selection.fromJSON(opened.doc, { type: 'text', anchor: range[0], head: range[1] })
      : caret === undefined
        ? undefined
        : Selection.near(opened.doc.resolve(caret));
    place = document.createElement('div');
    document.body.append(place);
    view = mountEditor(place, {
      state: createEditorState({
        doc: opened.doc,
        newIdentifier: () => `b${(blocks += 1)}`,
        ...(selection ? { selection } : {}),
      }),
      label: 'Content of Install the printer',
      editable: () => true,
      dispatch: (transaction, target) => {
        dispatched.push(transaction);
        target.updateState(target.state.apply(transaction));
      },
      refused: () => undefined,
    });
  }
  render(
    <StrictMode>
      <EditorToolbar
        view={view}
        enabled={enabled}
        newIdentifier={newIdentifier}
        prompt={prompt}
        onRefused={onRefused}
      />
    </StrictMode>,
  );
  return { view: view as EditorView, dispatched, prompt, onRefused };
}

describe('the formatting toolbar', () => {
  it('CNT-077 offers every command as a button reachable by keyboard alone', async () => {
    const { view: mounted } = renderToolbar({ range: [1, 6] });
    const toolbar = screen.getByRole('toolbar', { name: 'Formatting' });
    const buttons = within(toolbar).getAllByRole('button');

    expect(
      buttons.map((button) => button.getAttribute('aria-label') ?? button.textContent),
    ).toEqual(LABELS);
    expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
    buttons[0]!.focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(document.activeElement).toBe(buttons[2]);
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(buttons[8]);
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(buttons[0]);
    // Both ways, and both wraps: a row a key can only be walked one way along is half a row.
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(buttons[8]);
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(buttons[7]);
    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(buttons[0]);
    expect(buttons[0]).toHaveAttribute('title', 'Ctrl or Cmd and B');

    // Reachable is not the whole of it: the command has to run from the keyboard as well.
    await userEvent.keyboard('{Enter}');
    expect(runsOf(mounted)).toEqual([
      { type: 'text', value: 'Unbox', marks: [{ type: 'strong', id: 'm1' }] },
      { type: 'text', value: ' the printer.', marks: [] },
    ]);
  });

  it('is a dialog for the two commands that ask for a value, and a toggle for the rest', async () => {
    // A button that opens a dialog is not a toggle: pressing Link never takes a link off, so
    // announcing it as pressed promises a second press that would undo it, and there is none.
    renderToolbar({ range: [1, 6] });
    const buttons = within(screen.getByRole('toolbar', { name: 'Formatting' })).getAllByRole(
      'button',
    );

    for (const label of TOGGLES) {
      const button = screen.getByRole('button', { name: label });
      expect(button).toHaveAttribute('aria-pressed', 'false');
      expect(button).not.toHaveAttribute('aria-haspopup');
    }
    for (const label of ['Link', 'Language']) {
      const button = screen.getByRole('button', { name: label });
      expect(button).toHaveAttribute('aria-haspopup', 'dialog');
      expect(button).not.toHaveAttribute('aria-pressed');
    }
    expect(buttons).toHaveLength(LABELS.length);
  });

  it('keeps the focus on the surface when a button is pressed', async () => {
    // A press must not take the focus from the surface: a toolbar button that focused itself would
    // collapse the selection the command is about to act on, and leave the author's place lost.
    const { view: mounted } = renderToolbar({ range: [1, 6] });
    mounted.focus();
    expect(mounted.dom).toHaveFocus();

    await userEvent.click(screen.getByRole('button', { name: 'Strong' }));

    expect(mounted.dom).toHaveFocus();
  });

  it('says which mark the selection already carries', () => {
    renderToolbar({
      document: stored(run('Unbox', { type: 'emphasis', id: 'a1' }), run(' the printer.')),
      caret: 3,
    });

    expect(screen.getByRole('button', { name: 'Emphasis' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Strong' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('says nothing is marked where only part of the selection carries it', () => {
    // Pressed means throughout, never anywhere in it: the command marks the rest of a half-marked
    // selection rather than clearing it, so a button that called itself pressed here would say the
    // opposite of what pressing it does.
    renderToolbar({
      document: stored(run('Unbox', { type: 'emphasis', id: 'a1' }), run(' the printer.')),
      range: [1, 10],
    });

    expect(screen.getByRole('button', { name: 'Emphasis' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('marks the selection when a button is pressed', async () => {
    const { view: mounted } = renderToolbar({ range: [1, 6] });

    await userEvent.click(screen.getByRole('button', { name: 'Strong' }));

    expect(runsOf(mounted)).toEqual([
      { type: 'text', value: 'Unbox', marks: [{ type: 'strong', id: 'm1' }] },
      { type: 'text', value: ' the printer.', marks: [] },
    ]);
  });

  it('asks for a target before it links, and does nothing when the author cancels', async () => {
    const { view: mounted, dispatched, prompt } = renderToolbar({ range: [1, 6], answer: null });
    const before = mounted.state.doc;

    await userEvent.click(screen.getByRole('button', { name: 'Link' }));

    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    // Asked with the command itself and with what the selection carries today - nothing here - so a
    // dialog opens filled in where there is something to fill it with.
    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({ mark: 'hyperlink', label: 'Link' }),
      null,
    );
    expect(dispatched).toEqual([]);
    expect(mounted.state.doc.eq(before)).toBe(true);
  });

  it('puts the target the author gave over the selection', async () => {
    const { view: mounted } = renderToolbar({
      range: [1, 6],
      answer: { href: 'https://example.test/report', title: null },
    });

    await userEvent.click(screen.getByRole('button', { name: 'Link' }));

    await waitFor(() =>
      expect(runsOf(mounted)).toEqual([
        {
          type: 'text',
          value: 'Unbox',
          marks: [{ type: 'hyperlink', id: 'm1', href: 'https://example.test/report' }],
        },
        { type: 'text', value: ' the printer.', marks: [] },
      ]),
    );
  });

  it('opens filled with the link the selection carries, and re-targets it under a new name', async () => {
    const { view: mounted, prompt } = renderToolbar({
      document: stored(
        run('Unbox', { type: 'hyperlink', id: 'a1', href: 'https://example.test/old' }),
        run(' the printer.'),
      ),
      range: [1, 6],
      answer: { href: 'https://example.test/new', title: null },
    });

    await userEvent.click(screen.getByRole('button', { name: 'Link' }));

    // Filled from what is there, without the identifier: the changed target is a new annotation, and
    // a prompt handed the old name would send it back with the new value (CNT-004).
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ mark: 'hyperlink' }), {
      href: 'https://example.test/old',
      title: null,
    });
    await waitFor(() =>
      expect(runsOf(mounted)).toEqual([
        {
          type: 'text',
          value: 'Unbox',
          marks: [{ type: 'hyperlink', id: 'm1', href: 'https://example.test/new' }],
        },
        { type: 'text', value: ' the printer.', marks: [] },
      ]),
    );
  });

  it('says so when the value the author gave could not be applied', async () => {
    // A target the stored model refuses (CNT-127's allowlist) leaves the document alone, and the
    // author typed something: a press that ends in nothing is the one case they must be told about.
    const { view: mounted, onRefused } = renderToolbar({
      range: [1, 6],
      answer: { href: 'javascript:alert(1)' },
    });
    const before = mounted.state.doc;

    await userEvent.click(screen.getByRole('button', { name: 'Link' }));

    await waitFor(() =>
      expect(onRefused).toHaveBeenCalledWith(expect.objectContaining({ mark: 'hyperlink' })),
    );
    expect(mounted.state.doc.eq(before)).toBe(true);
  });

  it('does not ask for a value where there is nowhere to put it', async () => {
    // A cursor in unmarked text has nothing to link: opening a dialog there asks the author for a
    // target the command would then drop on the floor.
    const { prompt, onRefused } = renderToolbar({ caret: 3 });

    await userEvent.click(screen.getByRole('button', { name: 'Link' }));

    expect(prompt).not.toHaveBeenCalled();
    expect(onRefused).not.toHaveBeenCalled();
  });

  it('says so when the dialog itself fails rather than leaving the rejection unhandled', async () => {
    const { onRefused } = renderToolbar({
      range: [1, 6],
      asks: () => Promise.reject(new Error('the dialog fell over')),
    });

    await userEvent.click(screen.getByRole('button', { name: 'Link' }));

    await waitFor(() =>
      expect(onRefused).toHaveBeenCalledWith(expect.objectContaining({ mark: 'hyperlink' })),
    );
  });

  it('lets an answer arriving after the surface has gone by, rather than dispatching into it', async () => {
    let settle: ((value: Record<string, unknown> | null) => void) | undefined;
    const { view: mounted, onRefused } = renderToolbar({
      range: [1, 6],
      asks: () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    });

    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    mounted.destroy();
    settle!({ href: 'https://example.test/report' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // A dispatch into a destroyed view throws, which the catch below would then report to the author
    // as a refusal of a target that was perfectly good.
    expect(onRefused).not.toHaveBeenCalled();
  });

  it('is unavailable while the component may not be changed', async () => {
    // `aria-disabled`, not `disabled`: a disabled button is out of the tab order, so a `disabled`
    // toolbar is one a keyboard cannot reach at all - and the region ring will need somewhere to
    // land. It stays in the accessibility tree, reachable and inert.
    const { view: mounted, prompt } = renderToolbar({ enabled: false, range: [1, 6] });
    const toolbar = screen.getByRole('toolbar', { name: 'Formatting' });
    const before = mounted.state.doc;

    const buttons = within(toolbar).getAllByRole('button');
    expect(buttons).toHaveLength(LABELS.length);
    for (const button of buttons) expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Strong' }));
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));

    expect(mounted.state.doc.eq(before)).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('stands there before the surface has mounted, saying nothing is marked', async () => {
    const { prompt } = renderToolbar({ mounted: false });
    const toolbar = screen.getByRole('toolbar', { name: 'Formatting' });

    const buttons = within(toolbar).getAllByRole('button');
    expect(buttons).toHaveLength(LABELS.length);
    expect(
      buttons
        .filter((button) => button.hasAttribute('aria-pressed'))
        .map((button) => button.getAttribute('aria-pressed')),
    ).toEqual(TOGGLES.map(() => 'false'));
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(prompt).not.toHaveBeenCalled();
  });
});
