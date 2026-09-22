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

import { shimRangeMeasurement } from '../test/range.js';
import { EditorToolbar, type EditorToolbarProps } from './EditorToolbar.js';

shimRangeMeasurement();

/** One paragraph of stored content, as the service answers it and `toEditor` opens it. */
const stored = (...inlines: unknown[]) => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: [{ type: 'paragraph', id: 'b1', style: 'body', content: inlines }],
});

const run = (value: string, ...marks: Mark[]) => ({ type: 'text', value, marks });

/** A stored document of whole blocks, where `stored` above makes one paragraph of runs. */
const storedBlocks = (...content: unknown[]) => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content,
});

const paragraph = (id: string, text: string) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: [{ type: 'text', value: text, marks: [] }],
});

const listOf = (kind: 'ordered' | 'unordered', ...texts: string[]) => ({
  type: 'list',
  id: 'L1',
  kind,
  items: texts.map((text, at) => ({ content: [paragraph(`i${at + 1}`, text)] })),
});

const definitionListOf = (word: string, meaning: string) => ({
  type: 'list',
  id: 'D1',
  kind: 'definition',
  items: [{ term: [run(word)], content: [paragraph('d1', meaning)] }],
});

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
  'Bulleted list',
  'Numbered list',
  'Definition list',
  'Nest item',
  'Lift item',
  'Quotation',
  'Preformatted text',
];

/** The seven marks that apply where they stand; the two after them open a dialog first. */
const TOGGLES = LABELS.slice(0, 7);

/** The three block buttons that say which kind of list the cursor stands in. */
const KINDS = ['Bulleted list', 'Numbered list', 'Definition list'];

/** The two that move an item a level, which are not toggles and have no state to be in. */
const MOVES = ['Nest item', 'Lift item'];

interface ToolbarOptions {
  readonly document?: unknown;
  readonly enabled?: boolean;
  /** What the prompt resolves with: null is the author cancelling. */
  readonly answer?: Record<string, unknown> | null;
  /** The whole prompt, where a test needs one that hangs or throws rather than one that answers. */
  readonly asks?: EditorToolbarProps['prompt'];
  /** A cursor at this position before the toolbar renders. */
  readonly caret?: number;
  /**
   * A cursor inside the block carrying this identifier, or inside the first term where it is
   * `term`: a position in a nested document is not a number anybody should be counting by hand.
   */
  readonly caretIn?: string;
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
    caretIn,
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
    let at = -1;
    if (caretIn !== undefined) {
      opened.doc.descendants((node, pos) => {
        if (at !== -1) return false;
        if (node.attrs.id === caretIn || (caretIn === 'term' && node.type.name === 'term')) {
          at = pos + 1;
        }
        return true;
      });
      if (at === -1) throw new Error(`no ${caretIn} in this fixture`);
    }
    // `Selection.fromJSON` is the only route to a range selection through the editor package's own
    // exports, which are what a renderer may import: `TextSelection` is not among them.
    const selection = range
      ? Selection.fromJSON(opened.doc, { type: 'text', anchor: range[0], head: range[1] })
      : at !== -1
        ? Selection.near(opened.doc.resolve(at))
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
      pasted: () => undefined,
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

    // Each is named by the registry's own label, the only name a screen reader gets: the face is
    // an icon, hidden from assistive technology, and no word may be dropped (interface slice 13).
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(LABELS);
    for (const button of buttons) {
      expect(button.querySelector('[data-icon]')).toHaveAttribute('aria-hidden', 'true');
      expect(button.textContent?.trim().length ?? 0).toBeLessThanOrEqual(2);
    }
    expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
    buttons[0]!.focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(document.activeElement).toBe(buttons[2]);
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(buttons[15]);
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(buttons[0]);
    // Both ways, and both wraps: a row a key can only be walked one way along is half a row.
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(buttons[15]);
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(buttons[14]);
    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(buttons[0]);
    expect(buttons[0]).toHaveAttribute('title', 'Strong (Ctrl or Cmd and B)');
    // Marks, then lists, then blocks, in the registry's order, a divider between each group.
    expect(toolbar.querySelectorAll('[data-divider]')).toHaveLength(2);

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
      // Available, because there is a selection for the dialog's answer to land on: the positive
      // control for the caret case below.
      expect(button).toHaveAttribute('aria-disabled', 'false');
    }
    expect(buttons).toHaveLength(LABELS.length);
  });

  it('announces a dialog as unavailable where the press would open nothing', async () => {
    // A caret in plain text has nowhere to put a mark, so `pressCommand` refuses a prompting command
    // before it opens anything. Announced as an ordinary available button, a screen reader says
    // "Link, button, has popup dialog" in the most ordinary caret state there is, and pressing it
    // does nothing at all. `aria-disabled` is read from the same predicate the press is gated on.
    const { prompt } = renderToolbar({ caret: 3 });

    for (const label of ['Link', 'Language']) {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-disabled', 'true');
    }
    // The seven that apply where they stand are untouched: each stores a mark for the next
    // keystroke, so a caret is a perfectly good place to press one.
    for (const label of TOGGLES) {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-disabled', 'false');
    }
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(prompt).not.toHaveBeenCalled();
  });

  it('says which kind of list the cursor stands in, and says nothing about the two that move an item', () => {
    renderToolbar({
      document: storedBlocks(listOf('unordered', 'Unbox the printer.', 'Keep the box.')),
      caretIn: 'i1',
    });

    expect(screen.getByRole('button', { name: 'Bulleted list' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    for (const label of ['Numbered list', 'Definition list']) {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false');
    }
    // Nest item and Lift item move an item a level in one direction: neither is a toggle, so
    // neither has a state to be in, and announcing one as pressed would promise a second press
    // that undid it. Neither opens anything either.
    for (const label of MOVES) {
      const button = screen.getByRole('button', { name: label });
      expect(button).not.toHaveAttribute('aria-pressed');
      expect(button).not.toHaveAttribute('aria-haspopup');
    }
  });

  it('announces a block command as unavailable wherever pressing it would do nothing', () => {
    // The defect this toolbar has now been fixed for twice, in its third shape. `blockCommand`
    // declines to unmake a definition list - there is no lossless way to, because a term has no
    // home outside one - so a **Definition list** button that read its pressed state from `listAt`
    // alone would announce itself as available and pressed, inside the one place pressing it does
    // nothing at all. The answer is taken from the command itself, asked with no dispatch.
    renderToolbar({
      document: storedBlocks(definitionListOf('Creep', 'Slow strain under a steady load.')),
      caretIn: 'd1',
    });

    const definition = screen.getByRole('button', { name: 'Definition list' });
    expect(definition).toHaveAttribute('aria-pressed', 'true');
    expect(definition).toHaveAttribute('aria-disabled', 'true');
    // Nest item declines on the first item of a list, and Lift item declines at the top level of a
    // definition list, which is the limit `blockCommand` names in full rather than an oversight.
    for (const label of MOVES) {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-disabled', 'true');
    }
    // A counted list nested in the definition being written is a real thing to want, so those two
    // stay available: this is a negative control, not a toolbar that has simply gone quiet.
    for (const label of ['Bulleted list', 'Numbered list']) {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-disabled', 'false');
    }
  });

  it('offers no list command at all with the cursor in a term', () => {
    // A term is inline content with no home outside its item, so there is no block there to wrap,
    // to unwrap or to lift. All three list commands decline, and the toolbar says so.
    renderToolbar({
      document: storedBlocks(definitionListOf('Creep', 'Slow strain under a steady load.')),
      caretIn: 'term',
    });

    for (const label of KINDS) {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-disabled', 'true');
    }
  });

  it('makes a list when a block button is pressed, and takes it off when it is pressed again', async () => {
    const { view: mounted } = renderToolbar({ caret: 3 });

    await userEvent.click(screen.getByRole('button', { name: 'Bulleted list' }));

    expect(fromEditor(mounted.state.doc).content[0]).toMatchObject({
      type: 'list',
      kind: 'unordered',
      items: [{ content: [{ type: 'paragraph', id: 'b1' }] }],
    });

    await userEvent.click(screen.getByRole('button', { name: 'Bulleted list' }));

    // Back out again, under the identifier it went in with: the press wraps the paragraph rather
    // than rebuilding it, so nothing hanging on that identifier is renamed by a toolbar press.
    expect(fromEditor(mounted.state.doc).content).toMatchObject([{ type: 'paragraph', id: 'b1' }]);
  });

  it('runs no block command while the component may not be changed', async () => {
    const { view: mounted } = renderToolbar({ enabled: false, caret: 3 });
    const before = mounted.state.doc;

    await userEvent.click(screen.getByRole('button', { name: 'Bulleted list' }));

    expect(mounted.state.doc.eq(before)).toBe(true);
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
    // Focus it for its own sake, not through the attribute: `tabIndex` still reads 0 on a natively
    // disabled button, so the count above passes either way. This is the half of the rule that
    // matters, and it is the half a `disabled` attribute would break.
    buttons[0]!.focus();
    expect(document.activeElement).toBe(buttons[0]);

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
    ).toEqual([...TOGGLES, ...KINDS].map(() => 'false'));
    // No state to read, so every block command is unavailable too: a press before the surface
    // exists has no document to act on, exactly as the two dialogs have nowhere to put a mark.
    for (const label of [...KINDS, ...MOVES]) {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-disabled', 'true');
    }
    // There is no state to ask where a mark could go, so the two dialogs are unavailable rather than
    // available-and-inert: a press before the surface exists opens nothing either.
    for (const label of ['Link', 'Language']) {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-disabled', 'true');
    }
    for (const label of TOGGLES) {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-disabled', 'false');
    }
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(prompt).not.toHaveBeenCalled();
  });
});
