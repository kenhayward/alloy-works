import { bindingDigestInput, parseContentDocument, type Binding } from '@alloy-works/domain';
import {
  armEditorOf,
  createEditorState,
  fromEditor,
  mountEditor,
  NodeSelection,
  renderContent,
  Selection,
  toEditor,
  type BindingContext,
  type EditorView,
} from '@alloy-works/editor';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * A message form on the editing surface (the MF plan, MF-G): its chip, drawn as the arm its held value
 * selects, and its arms, each an editor of its own while the form is selected.
 */

const QUERY = '00000000-0000-4000-8000-00000000d001';

const bound: Binding = {
  type: 'binding',
  id: 'k1',
  query: QUERY,
  parameters: { site: { literal: 'north' } },
  mode: 'checked',
  take: { column: 'visits' },
};

const text = (value: string) => ({ type: 'text', value, marks: [] });

const form = (id: string) => ({
  type: 'messageForm',
  id,
  kind: 'plural',
  binding: { ...bound, id: `${id}-k` },
  arms: {
    '=0': [text('no visits')],
    one: [{ type: 'messageValue' }, text(' visit')],
    other: [{ type: 'messageValue' }, text(' visits')],
  },
});

const component = () =>
  parseContentDocument({
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
          text('We made '),
          form('f1'),
          text(' this year'),
          {
            type: 'footnote',
            id: 'n1',
            anchor: { kind: 'span' },
            content: [
              { type: 'paragraph', id: 'b2', style: 'body', content: [text('And '), form('f2')] },
            ],
          },
        ],
      },
    ],
  });

const CONTEXT: BindingContext = {
  kind: 'document',
  held: new Map(
    [
      ['f1-k', '3'],
      ['f2-k', '1'],
    ].map(([id, value]) => [
      id!,
      {
        binding: bindingDigestInput({ ...bound, id: id! }),
        shown: { value: value!, waiting: false, number: { value: value!, scale: 0 } },
      },
    ]),
  ),
};

const mounted: EditorView[] = [];
afterEach(() => {
  for (const view of mounted.splice(0)) view.destroy();
});

function mount(bindingContext: BindingContext | null = CONTEXT): EditorView {
  const opened = toEditor(component());
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

/** The form at `id`'s position in the surface's document. */
function formAt(view: EditorView, id: string): number {
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'messageForm' && node.attrs.id === id) at = pos;
  });
  return at;
}

/** The form opened, as selecting it opens it; its arms' textboxes by their names. */
function open(view: EditorView): Map<string, HTMLElement> {
  view.dispatch(
    view.state.tr.setSelection(NodeSelection.create(view.state.doc, formAt(view, 'f1'))),
  );
  const group = view.dom.querySelector('[role="group"]');
  if (group === null) throw new Error('The form did not open');
  return new Map(
    [...group.querySelectorAll<HTMLElement>('[role="textbox"]')].map((each) => [
      each.getAttribute('aria-label')!,
      each,
    ]),
  );
}

const armsOf = (view: EditorView) =>
  (
    fromEditor(view.state.doc).content[0] as { content: { id?: string; arms?: unknown }[] }
  ).content.find((each) => each.id === 'f1')!.arms as Record<string, unknown>;

describe('a message form on the editing surface (the MF plan, MF-G)', () => {
  it('LOC-045 shows the arm its held value selects, the value in it, and says it varies by a number', () => {
    const view = mount();
    const chips = [...view.dom.querySelectorAll('.aw-message-form-chip')];
    expect(chips.map((each) => each.firstChild!.textContent)).toEqual(['3 visits']);
    expect(chips[0]!.querySelector('.aw-binding-hidden')!.textContent).toBe(
      ', words varying by a number',
    );
  });

  it('opens an arm for each category of its language and each exact arm, each an editor of its one history', () => {
    const view = mount();
    const arms = open(view);
    expect([...arms.keys()]).toEqual(['one, as for 1', 'other, as for 0, 2, 3', 'Exactly 0']);
    const one = armEditorOf(arms.get('one, as for 1')!)!;
    one.dispatch(one.state.tr.insertText('s', one.state.doc.content.size));
    expect(armsOf(view).one).toEqual([{ type: 'messageValue' }, text(' visits')]);
    // Still open, and the surface's history holds it.
    expect(view.dom.querySelector('[role="group"]')).not.toBeNull();
    // Undone from the arm's own keys, in the surface's history.
    const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform);
    one.someProp('handleKeyDown', (handle) =>
      handle(one, { key: 'z', keyCode: 90, ctrlKey: !mac, metaKey: mac } as never),
    );
    expect(armsOf(view).one).toEqual([{ type: 'messageValue' }, text(' visit')]);
    expect(one.state.doc.textContent).toBe(' visit');
  });

  it('removes an exact arm by its button and adds one from its list', () => {
    const view = mount();
    open(view);
    const remove = view.dom.querySelector<HTMLButtonElement>('.aw-message-arm-remove')!;
    expect(remove.textContent).toBe('Remove Exactly 0');
    remove.click();
    expect(Object.keys(armsOf(view))).toEqual(['one', 'other']);
    const add = view.dom.querySelector<HTMLSelectElement>('.aw-message-arm-add')!;
    expect(add.getAttribute('aria-label')).toBe('Add words for exactly one number');
    add.value = '=5';
    add.dispatchEvent(new Event('change'));
    expect(armsOf(view)['=5']).toEqual([{ type: 'messageValue' }]);
    expect([...open(view).keys()]).toContain('Exactly 5');
  });

  it("LOC-045 draws a form in a footnote's text by the component's language", () => {
    const view = mount();
    let at = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'footnote') at = pos;
    });
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at)));
    const chip = view.dom.querySelector('.aw-footnote-editor .aw-message-form-chip')!;
    expect(chip.firstChild!.textContent).toBe('1 visit');
  });

  it('is copied as its selected arm, and read so in the read text', () => {
    const view = mount();
    view.dispatch(
      view.state.tr.setSelection(
        Selection.fromJSON(view.state.doc, { type: 'text', anchor: 1, head: 20 }),
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
    expect(written.get('text/plain')).toMatch(/^We made 3 visits this year/);
    const read = renderContent(component(), document, null, CONTEXT)!;
    const holder = document.createElement('div');
    holder.append(read);
    expect(holder.querySelector('[data-message-form]')!.firstChild!.textContent).toBe('3 visits');
  });
});
