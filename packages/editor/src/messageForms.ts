import {
  armFor,
  bindingDigestInput,
  EXACT_ARMS,
  PLURAL_CATEGORIES,
  pluralCategoriesOf,
  type MessageArm,
  type MessageArmKey,
  type MessageFormNode,
} from '@alloy-works/domain';
import type { Node } from 'prosemirror-model';
import { NodeSelection, type Command, type EditorState } from 'prosemirror-state';

import {
  BINDING_FAILURE_WORDS,
  bindingSelected,
  shownFor,
  type BindingContext,
} from './bindings.js';
import { bindingContextOf } from './bindingView.js';
import { editorSchema } from './schema.js';
import { say } from './words.js';

const messageFormNode = editorSchema.nodes.messageForm!;

/** What one message form shows on the surface, in the read text and in a copy (the MF plan, MF-G). */
export interface MessageFormShown {
  readonly pos: number;
  readonly id: string | null;
  /** The selected arm's words, the value formatted in it; or why there is none. */
  readonly text: string;
  /** What a screen reader is told after it: that its words vary by a number. */
  readonly hidden: string;
  /** Its binding's marker beside a value, _revision waiting_ or a person's, or null. */
  readonly marker: string | null;
  /** Whether no arm could be shown, drawn apart as a failed binding is. */
  readonly failed: boolean;
  /** The arm shown, or null where none is. */
  readonly arm: MessageArmKey | null;
}

/** An arm's words, its value printed as `value`. */
const armWords = (arm: MessageArm, value: string): string =>
  arm.map((inline) => (inline.type === 'messageValue' ? value : inline.value)).join('');

/** One form's words in `context`, by the rule the publish selects by (`armFor`, MF-E). */
function shownOf(
  form: Pick<MessageFormNode, 'binding' | 'arms'>,
  context: BindingContext | null,
  language: string,
): Omit<MessageFormShown, 'pos' | 'id'> {
  const hidden = say('message-form.kind');
  if (context === null) {
    return {
      text: say('message-form.varies-by-number'),
      hidden,
      marker: null,
      failed: false,
      arm: null,
    };
  }
  const value = shownFor(form.binding, context);
  // On its own, what it asks for in its `other` arm, as a binding shows what it asks for (BI-B).
  if (context.kind === 'alone') {
    return {
      text: armWords(form.arms.other ?? [], value.text),
      hidden,
      marker: null,
      failed: false,
      arm: 'other',
    };
  }
  const failed = (text: string) => ({ text, hidden, marker: null, failed: true, arm: null });
  if (value.failed) return failed(value.text);
  const held = context.held.get(form.binding.id)!.shown;
  const number = 'value' in held ? held.number : undefined;
  if (number === undefined) return failed(BINDING_FAILURE_WORDS.value_not_number());
  const chosen = armFor(form.arms, number.value, number.scale, language);
  if ('missing' in chosen) {
    return failed(say('message-form.arm-missing', { category: chosen.missing }));
  }
  return {
    text: armWords(form.arms[chosen.arm]!, value.text),
    hidden,
    marker: value.marker,
    failed: false,
    arm: chosen.arm,
  };
}

/**
 * **What each message form in `doc` shows** (the MF plan, MF-G), in document order: in a document, the
 * arm its held value selects in `language` - the component's - by `armFor`, the function the publish
 * selects by, with the value as the binding shows it; why there is none, as a binding says, or the
 * arm the value calls for that it lacks; on its own, its `other` arm with what it asks for; with no
 * context, what the node alone says. Pure, as `bindingsShown` is, for the surface, a footnote's own
 * editor, the read text and the copy.
 */
export function messageFormsShown(
  doc: Node,
  context: BindingContext | null,
  language: string = doc.attrs.language as string,
): readonly MessageFormShown[] {
  const shown: MessageFormShown[] = [];
  doc.descendants((node, pos) => {
    if (node.type !== messageFormNode) return true;
    const id = typeof node.attrs.id === 'string' ? node.attrs.id : null;
    const form = {
      binding: node.attrs.binding as MessageFormNode['binding'],
      arms: node.attrs.arms as MessageFormNode['arms'],
    };
    shown.push({ pos, id, ...shownOf(form, context, language) });
    return false;
  });
  return shown;
}

/** Whether the document holds the binding's value as it stands and it is no number. */
function heldNotNumber(state: EditorState, binding: MessageFormNode['binding']): boolean {
  const context = bindingContextOf(state);
  if (context?.kind !== 'document') return false;
  const held = context.held.get(binding.id);
  if (held === undefined || held.binding !== bindingDigestInput(binding)) return false;
  if ('failure' in held.shown) return held.shown.failure === 'value_not_number';
  return !('value' in held.shown) || held.shown.number === undefined || 'image' in held.shown;
}

/**
 * **Message form** (the MF plan, MF-G): the selected binding wrapped in a form of its own, an arm for
 * each plural category of the component's language, each printing the value alone for the author to
 * write around; the form left selected, so its arms open. Refused where no binding is selected, or the
 * document holds a value for it that is no number (MF-E's `value_not_number`).
 */
export function wrapInMessageForm(newIdentifier: () => string): Command {
  return (state, dispatch) => {
    const selected = bindingSelected(state);
    if (selected === null || heldNotNumber(state, selected.binding)) return false;
    if (dispatch) {
      const language = state.doc.attrs.language as string;
      const arms = Object.fromEntries(
        pluralCategoriesOf(language).map((key) => [key, [{ type: 'messageValue' }]]),
      );
      const form = messageFormNode.create({
        id: newIdentifier(),
        kind: 'plural',
        binding: selected.binding,
        arms,
      });
      const tr = state.tr.replaceWith(selected.pos, selected.pos + 1, form);
      tr.setSelection(NodeSelection.create(tr.doc, selected.pos));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** One arm as the opened form lists it: whether the form holds it, and whether its language lacks it. */
export interface ArmListed {
  readonly key: MessageArmKey;
  readonly lacking: boolean;
  readonly held: boolean;
}

/**
 * **The arms an opened form lists** (MF-G): one for each category of `language`, held or not, then
 * each exact arm it holds, then each it holds for a category the language lacks - shown, so nothing
 * stored is hidden, and removable, since no value in that language selects it.
 */
export function armsListed(language: string, arms: MessageFormNode['arms']): readonly ArmListed[] {
  const categories: readonly MessageArmKey[] = pluralCategoriesOf(language);
  return [
    ...categories.map((key) => ({ key, lacking: false, held: arms[key] !== undefined })),
    ...EXACT_ARMS.filter((key) => arms[key] !== undefined).map((key) => ({
      key,
      lacking: false,
      held: true,
    })),
    ...PLURAL_CATEGORIES.filter((key) => !categories.includes(key) && arms[key] !== undefined).map(
      (key) => ({ key, lacking: true, held: true }),
    ),
  ];
}

/** The form at `pos`'s arms changed by `change`, as one step; refused where none stands there. */
function changeArms(
  pos: number,
  change: (arms: MessageFormNode['arms']) => MessageFormNode['arms'] | null,
): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (node?.type !== messageFormNode) return false;
    const next = change(node.attrs.arms as MessageFormNode['arms']);
    if (next === null) return false;
    if (dispatch) dispatch(state.tr.setNodeAttribute(pos, 'arms', next));
    return true;
  };
}

/**
 * An arm's words set, as its own editor reads them back: one emptied is no arm, so a value calling for
 * it fails the publish by name rather than printing nothing (MF-E) - but `other`, which a form keeps
 * (MF-C).
 */
export const setArm = (pos: number, key: MessageArmKey, arm: MessageArm): Command =>
  changeArms(pos, (arms) => {
    const next = { ...arms, [key]: arm };
    if (arm.length === 0 && key !== 'other') delete next[key];
    return next;
  });

/** An arm taken away; never `other`. */
export const removeArm = (pos: number, key: MessageArmKey): Command =>
  changeArms(pos, (arms) => {
    if (key === 'other' || arms[key] === undefined) return null;
    const next = { ...arms };
    delete next[key];
    return next;
  });

/** An exact arm added, printing the value alone, where the form has none for it (MF-A). */
export const addExactArm = (pos: number, key: (typeof EXACT_ARMS)[number]): Command =>
  changeArms(pos, (arms) =>
    arms[key] === undefined ? { ...arms, [key]: [{ type: 'messageValue' }] } : null,
  );
