import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { bindingDigestInput, parseContentDocument, type Binding } from '@alloy-works/domain';
import {
  createEditorState,
  mountEditor,
  NodeSelection,
  Selection,
  toEditor,
  type BindingContext,
  type BindingHeld,
  type EditorView,
} from '@alloy-works/editor';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * What a binding shows on the editing surface, a footnote's own editor among it (the B1 plan, B1-D,
 * B1-J, B1-L): drawn by the node view from what its decoration carries.
 */

const QUERY = '00000000-0000-4000-8000-00000000d001';
const NS = 'http://www.w3.org/1998/Math/MathML';
const SQUARED = `<math xmlns="${NS}" alttext="x squared"><msup><mi>x</mi><mn>2</mn></msup></math>`;

const bound = (id: string): Binding => ({
  type: 'binding',
  id,
  query: QUERY,
  parameters: { site: { literal: 'north' } },
  mode: 'checked',
  take: { column: 'depth' },
});

const text = (value: string) => ({ type: 'text', value, marks: [] });

/**
 * A paragraph holding a value, a failed binding, a reference, an equation and an image, and a
 * footnote holding a value and a failed one - or, `without`, the same with every binding taken out.
 */
const component = (without = false) => {
  const binding = (id: string) => (without ? [] : [bound(id)]);
  return parseContentDocument({
    schemaVersion: 1,
    title: 'Site visits',
    language: 'en-GB',
    direction: 'ltr',
    content: [
      {
        type: 'paragraph',
        id: 'b1',
        style: 'body',
        content: [
          text('The mean was '),
          ...binding('k1'),
          text(' m and '),
          ...binding('k2'),
          text(', see '),
          {
            type: 'crossReference',
            id: 'x1',
            target: { kind: 'block', block: 'b2' },
            display: 'number',
          },
          text(' where '),
          { type: 'equation', mathml: SQUARED },
          text(' by '),
          {
            type: 'image',
            asset: '00000000-0000-4000-8000-00000000a551',
            imageStyle: 'inline',
            alternative: { kind: 'decorative' },
          },
          {
            type: 'footnote',
            id: 'f1',
            anchor: { kind: 'span' },
            content: [
              {
                type: 'paragraph',
                id: 'fp1',
                style: 'body',
                content: [text('Also '), ...binding('k3'), text(' and '), ...binding('k4')],
              },
            ],
          },
        ],
      },
      { type: 'paragraph', id: 'b2', style: 'body', content: [text('End.')] },
    ],
  });
};

const held = (id: string, shown: BindingHeld['shown']): [string, BindingHeld] => [
  id,
  { binding: bindingDigestInput(bound(id)), shown },
];

const CONTEXT: BindingContext = {
  kind: 'document',
  held: new Map([
    held('k1', { value: '1,234.5', waiting: false }),
    held('k2', { failure: 'value_many', count: 3 }),
    held('k3', { value: '7', waiting: true }),
    held('k4', { failure: 'value_null' }),
  ]),
};

const mounted: EditorView[] = [];
afterEach(() => {
  for (const view of mounted.splice(0)) view.destroy();
});

function mount(without: boolean, bindingContext: BindingContext | null): EditorView {
  const opened = toEditor(component(without));
  if (!opened.editable) throw new Error(opened.unsupported.join(', '));
  const place = document.createElement('div');
  document.body.append(place);
  const view = mountEditor(place, {
    state: createEditorState({ doc: opened.doc, newIdentifier: () => 'x', bindingContext }),
    label: 'Content',
    editable: () => true,
    dispatch: (tr, target) => target.updateState(target.state.apply(tr)),
    pasted: () => undefined,
    refused: () => undefined,
  });
  mounted.push(view);
  return view;
}

/** The footnote's own editor, opened as selecting its mark opens it. */
function openFootnote(view: EditorView): HTMLElement {
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'footnote') at = pos;
  });
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at)));
  const editor = view.dom.querySelector<HTMLElement>('.aw-footnote-editor [role="textbox"]');
  if (editor === null) throw new Error('The footnote did not open');
  return editor;
}

const bindingsIn = (root: Element) =>
  [...root.querySelectorAll('.aw-binding')].map((each) => ({
    text: each.textContent,
    failed: each.classList.contains('aw-binding-failed'),
  }));

describe('a binding on the editing surface', () => {
  it('DAT-047 shows a binding whose value fails in place with its reason, apart by more than colour, and draws the rest of the component as before', () => {
    const view = mount(false, CONTEXT);
    const paragraph = view.dom.querySelector('p')!;
    expect(bindingsIn(paragraph).slice(0, 2)).toEqual([
      { text: '1,234.5, bound value', failed: false },
      { text: 'No value - the query returned 3 rows, bound value, failed', failed: true },
    ]);
    // In the footnote's own editor too, a value with its revision waiting and a failure.
    expect(bindingsIn(openFootnote(view))).toEqual([
      // The marker's icon is hidden from a screen reader; its words are not.
      { text: `7, bound value,${String.fromCodePoint(0x21bb)} revision waiting`, failed: false },
      { text: 'No value - empty, bound value, failed', failed: true },
    ]);

    // Apart by more than colour: its words say why, and the stylesheet draws it with a dashed border
    // and a wavy underline as well as its colour.
    const css = readFileSync(
      join(process.cwd(), '../../packages/editor/style.css'),
      'utf-8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    const failed = /\.aw-binding\.aw-binding-failed\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(failed).toMatch(/border:[^;]*dashed/);
    expect(failed).toMatch(/text-decoration:[^;]*wavy/);

    // The rest of the component draws exactly as it does with no binding in it.
    const without = mount(true, null);
    const drawn = (root: HTMLElement) =>
      ['.aw-reference', '.aw-equation', '.aw-inline-image-holder', 'sup.aw-footnote-mark'].map(
        (selector) => root.querySelector(selector)?.outerHTML,
      );
    const theirs = drawn(without.dom);
    expect(theirs.every((each) => each !== undefined)).toBe(true);
    expect(drawn(view.dom)).toEqual(theirs);
  });

  it('says what a binding asks for on its own, and Bound value with no context', () => {
    const alone = mount(false, { kind: 'alone', titles: new Map([[QUERY, 'Readings']]) });
    expect(alone.dom.querySelector('.aw-binding')?.textContent).toBe(
      'depth, Readings, bound value, a value in each document',
    );
    expect(alone.dom.querySelector('.aw-binding')).toHaveClass('aw-binding-alone');
    const bare = mount(false, null);
    expect(bare.dom.querySelector('.aw-binding')?.textContent).toBe('Bound value');
  });

  it('is copied to another application as what it shows, in plain text and in HTML', () => {
    const view = mount(false, CONTEXT);
    // The whole of the first paragraph's text.
    const paragraph = view.state.doc.firstChild!;
    view.dispatch(
      view.state.tr.setSelection(
        Selection.fromJSON(view.state.doc, {
          type: 'text',
          anchor: 1,
          head: paragraph.nodeSize - 1,
        }),
      ),
    );
    const written = new Map<string, string>();
    const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        clearData: () => written.clear(),
        setData: (type: string, value: string) => written.set(type, value),
      },
    });
    view.dom.dispatchEvent(event);
    expect(written.get('text/plain')).toMatch(
      /^The mean was 1,234\.5 m and No value - the query returned 3 rows, see /,
    );
    const html = document.createElement('div');
    html.innerHTML = written.get('text/html')!;
    expect(bindingsIn(html).slice(0, 2)).toEqual([
      { text: '1,234.5', failed: false },
      { text: 'No value - the query returned 3 rows', failed: true },
    ]);
  });

  it('holds its kind in words a screen reader is told, never an aria-label', () => {
    const view = mount(false, CONTEXT);
    const first = view.dom.querySelector('.aw-binding')!;
    expect(first).not.toHaveAttribute('aria-label');
    expect(first.querySelector('.aw-binding-hidden')).toHaveTextContent(', bound value');
  });
});
