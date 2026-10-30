import {
  EXACT_ARMS,
  pluralExamples,
  type MessageArmKey,
  type MessageFormNode,
} from '@alloy-works/domain';
import { baseKeymap } from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import type { Node } from 'prosemirror-model';
import { EditorState, Selection, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView, type NodeView } from 'prosemirror-view';

import { FAILED_CLASS, type BindingContext } from './bindings.js';
import { fillBinding } from './bindingView.js';
import { armFromEditor, armToEditor } from './mapping.js';
import { addExactArm, armsListed, messageFormsShown, removeArm, setArm } from './messageForms.js';
import { editorSchema } from './schema.js';
import { listOf, say } from './words.js';

/** A transaction an arm's editor takes from the form, which is not sent back to it. */
const FROM_OUTSIDE = 'messageArmFromOutside';

/** Each open arm's editor by its element, for the page and its tests to reach it. */
const armEditors = new WeakMap<Element, EditorView>();

/** The arm's editor whose element - its textbox - this is, or null. */
export const armEditorOf = (element: Element): EditorView | null => armEditors.get(element) ?? null;

/**
 * What each message form shows (the MF plan, MF-G), as node decorations over `doc`, the words in the
 * spec as a binding's are (`bindingDecorations`), so a form is drawn again exactly when they change.
 * `language` is the component's, which a footnote's own document does not carry.
 */
export function messageFormDecorations(
  doc: Node,
  context: BindingContext | null,
  language?: string,
): DecorationSet {
  return DecorationSet.create(
    doc,
    messageFormsShown(doc, context, language).map(({ pos, text, hidden, marker, failed }) =>
      Decoration.node(pos, pos + 1, failed ? { class: FAILED_CLASS } : {}, {
        formText: text,
        formHidden: hidden,
        formMarker: marker,
      }),
    ),
  );
}

/** What an arm is called beside its editor: its category and examples, or its exact value. */
export function armLabel(key: MessageArmKey, language: string, lacking: boolean): string {
  if (key.startsWith('=')) return say('message-form.arm-exact', { value: key.slice(1) });
  if (lacking) return say('message-form.arm-lacking', { category: key });
  const examples = pluralExamples(language, key as Exclude<MessageArmKey, `=${string}`>);
  return say('message-form.arm-category', { category: key, examples: listOf(examples, 'unit') });
}

/**
 * A message form on the surface (the MF plan, MF-G): a chip showing the arm its held value selects,
 * filled as a binding is (`fillBinding`), and told to a screen reader as words varying by a number;
 * and, while it is selected whole, its arms beneath it, as a footnote's text is (`footnoteView`): one
 * editor for each category of the component's language and each exact arm, and each arm it holds for a
 * category the language lacks, with a button removing it. An arm's editor is the arm alone; each change
 * is written to the form as one step of the component's one history (`setArm`), so `Ctrl+Z` in an arm
 * undoes the component, and a change the component makes comes back through `update`.
 */
export function messageFormView(
  node: Node,
  outer: EditorView,
  getPos: () => number | undefined,
  decorations: readonly Decoration[],
  language: () => string,
  /** Whose history `Ctrl+Z` reaches: the surface's, which a footnote's own editor has none of. */
  surface: EditorView = outer,
): NodeView {
  let shown = node;
  const document = outer.dom.ownerDocument;
  const dom = document.createElement('span');
  dom.className = 'aw-message-form';
  dom.setAttribute('data-message-form', '');
  const chip = document.createElement('span');
  chip.className = 'aw-message-form-chip';
  dom.append(chip);

  let drawn = '';
  const draw = (from: readonly Decoration[]) => {
    const carried = from.find((each) => typeof each.spec.formText === 'string');
    const next = carried
      ? {
          text: carried.spec.formText as string,
          hidden: carried.spec.formHidden as string,
          marker: carried.spec.formMarker as string | null,
        }
      : { text: say('message-form.varies-by-number'), hidden: '', marker: null };
    const key = [next.text, next.hidden, next.marker ?? ''].join('\u{0}');
    if (key === drawn) return;
    drawn = key;
    fillBinding(chip, next);
  };
  draw(decorations);

  let panel: HTMLElement | null = null;
  let editors = new Map<MessageArmKey, EditorView>();
  let listed = '';
  const armsOf = () => shown.attrs.arms as MessageFormNode['arms'];

  const history = (command: typeof undo) => () =>
    surface.editable && command(surface.state, (tr) => surface.dispatch(tr));

  const armEditor = (holder: HTMLElement, key: MessageArmKey, label: string) => {
    let view: EditorView | null = null;
    const forward = (tr: Transaction) => {
      const state = view!.state.apply(tr);
      const pos = getPos();
      if (tr.getMeta(FROM_OUTSIDE) === true || !tr.docChanged) {
        view!.updateState(state);
        return;
      }
      if (pos === undefined || !outer.editable) return;
      view!.updateState(state);
      setArm(pos, key, armFromEditor(state.doc))(outer.state, (outerTr) => outer.dispatch(outerTr));
    };
    view = new EditorView(holder, {
      state: EditorState.create({
        doc: armToEditor(armsOf()[key] ?? []),
        plugins: [
          keymap({
            'Mod-z': history(undo),
            'Mod-y': history(redo),
            'Shift-Mod-z': history(redo),
            // The value again, where the arm has none: the registry's chord for a form.
            'Mod-Alt-p': (state, dispatch) => {
              let has = false;
              state.doc.descendants((child) => {
                has ||= child.type.name === 'messageValue';
              });
              if (has) return false;
              dispatch?.(state.tr.replaceSelectionWith(editorSchema.nodes.messageValue!.create()));
              return true;
            },
            // Back to the form, still selected, as Escape leaves a footnote's text.
            Escape: () => {
              outer.focus();
              return true;
            },
          }),
          keymap(baseKeymap),
        ],
      }),
      editable: () => outer.editable,
      attributes: { role: 'textbox', 'aria-label': label, spellcheck: 'true', lang: language() },
      dispatchTransaction: forward,
    });
    armEditors.set(view.dom, view);
    return view;
  };

  const closePanel = () => {
    for (const view of editors.values()) view.destroy();
    editors = new Map();
    panel?.remove();
    panel = null;
    listed = '';
  };

  const openPanel = () => {
    // Where the focus was, kept across a rebuild: an arm emptied away, or one added or removed.
    const focused = [...editors].find(([, view]) => view.hasFocus())?.[0];
    closePanel();
    const arms = armsOf();
    const listing = armsListed(language(), arms);
    listed = listing.map(({ key }) => key).join(' ');
    panel = document.createElement('span');
    panel.className = 'aw-message-form-arms';
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', say('message-form.arms'));
    panel.contentEditable = 'false';
    for (const { key, lacking } of listing) {
      const row = document.createElement('span');
      row.className = 'aw-message-arm';
      row.setAttribute('data-arm', key);
      const label = armLabel(key, language(), lacking);
      const name = document.createElement('span');
      name.className = 'aw-message-arm-label';
      name.textContent = label;
      const holder = document.createElement('span');
      holder.className = 'aw-message-arm-editor';
      row.append(name, holder);
      if (key.startsWith('=') || lacking) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'aw-message-arm-remove';
        remove.textContent = say('message-form.remove-arm', { arm: label });
        remove.addEventListener('click', () => {
          const pos = getPos();
          if (pos === undefined || !outer.editable) return;
          removeArm(pos, key)(outer.state, (tr) => outer.dispatch(tr));
        });
        row.append(remove);
      }
      panel.append(row);
      editors.set(key, armEditor(holder, key, label));
    }
    const free = EXACT_ARMS.filter((key) => arms[key] === undefined);
    if (free.length > 0) {
      const add = document.createElement('select');
      add.className = 'aw-message-arm-add';
      add.setAttribute('aria-label', say('message-form.add-exact'));
      const none = document.createElement('option');
      none.value = '';
      none.textContent = say('message-form.add-exact');
      add.append(none);
      for (const key of free) {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = say('message-form.arm-exact', { value: key.slice(1) });
        add.append(option);
      }
      add.addEventListener('change', () => {
        const pos = getPos();
        const key = add.value as (typeof EXACT_ARMS)[number];
        if (pos === undefined || key === ('' as never) || !outer.editable) return;
        addExactArm(pos, key)(outer.state, (tr) => outer.dispatch(tr));
        editors.get(key)?.focus();
      });
      panel.append(add);
    }
    dom.append(panel);
    if (focused !== undefined) (editors.get(focused) ?? outer).focus();
  };

  /** Each open arm's editor brought to the form's arm, where a change came from outside it. */
  const sync = () => {
    if (panel === null) return;
    const arms = armsOf();
    if (
      armsListed(language(), arms)
        .map(({ key }) => key)
        .join(' ') !== listed
    ) {
      openPanel();
      return;
    }
    for (const [key, view] of editors) {
      const next = armToEditor(arms[key] ?? []);
      if (next.eq(view.state.doc)) continue;
      const selection = view.state.selection.toJSON();
      const tr = view.state.tr
        .replaceWith(0, view.state.doc.content.size, next.content)
        .setMeta(FROM_OUTSIDE, true);
      try {
        tr.setSelection(Selection.fromJSON(tr.doc, selection));
      } catch {
        // Past the end of what the arm now holds: the caret stays where the replace left it.
      }
      view.dispatch(tr);
    }
  };

  return {
    dom,
    update(next, nextDecorations) {
      if (next.type !== shown.type) return false;
      shown = next;
      draw(nextDecorations);
      sync();
      return true;
    },
    selectNode() {
      dom.classList.add('ProseMirror-selectednode');
      openPanel();
    },
    deselectNode() {
      dom.classList.remove('ProseMirror-selectednode');
      closePanel();
    },
    // Everything that happens in an arm, its buttons and its list is the form's own.
    stopEvent: (event) => panel !== null && panel.contains(event.target as globalThis.Node),
    ignoreMutation: () => true,
    destroy: closePanel,
  };
}
