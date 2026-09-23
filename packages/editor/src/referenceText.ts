import {
  kindWord,
  printed,
  type CrossReferenceDisplay,
  type CrossReferenceTarget,
  type ReferenceKind,
  type ReferenceTarget,
} from '@alloy-works/domain';
import type { Node } from 'prosemirror-model';

/**
 * What the host tells a surface about the document a component is being edited in (cross-references
 * 1, ruling R10): the targets that document offers, each with what it prints from - `documentTargets`
 * for the occurrence being edited. Null where the component is opened on its own, where there is no
 * document to number anything, and a reference to a section or to another component cannot be judged.
 */
export interface ReferenceContext {
  readonly targets: readonly ReferenceTarget[];
}

/** What one reference shows, and where it stands in the document it was read from. */
export interface ReferenceShown {
  readonly pos: number;
  readonly text: string;
  /** Whether its target has gone: drawn apart, and the text says so to a screen reader too. */
  readonly broken: boolean;
}

/** The class a broken reference carries, on the surface and read-only, so it is drawn apart. */
export const BROKEN_CLASS = 'aw-reference-broken';

/** What a reference whose target has gone says, in place of anything it would print. */
export const BROKEN_REFERENCE = 'Broken reference';

/**
 * What a reference to another component says where there is no document to find that component in.
 * Not broken: whether it resolves is the document's question, and there is none to ask.
 */
export const IN_ANOTHER_COMPONENT = 'In another component';

/** A node of the component with an identifier, which a `block` target can name. */
interface Held {
  readonly node: Node;
  readonly pos: number;
}

/**
 * **What each reference in `doc` shows** (ruling R10), in document order - pure, so the surface's
 * decorations, a footnote's own editor and a read-only rendering (R12) all draw the same words, and
 * every branch is tested without a DOM:
 *
 * - a `block` target the component no longer holds: _Broken reference_, and broken - on its own as in
 *   a document, since what a component holds is the component's own to say;
 * - one it holds that the context offers: what the context says it prints, in the reference's form,
 *   with _above_ or _below_ by **where the two stand in the component**. The document's outline cannot
 *   order a component's own blocks against each other; the component can. A target that holds the
 *   reference - a table whose caption refers to it - begins first, and counts as above, as a section
 *   holding the occurrence does in `documentTargets`;
 * - one it holds that the context does not offer - on its own, or placed since the page last numbered
 *   the document: the kind of thing it is and a figure's or a table's caption, _Table: Readings_,
 *   _Figure_, _Footnote_, _Paragraph_, read from the live document. Not broken: it is there, and a
 *   number is simply not known yet;
 * - a `node` or a `component` target in a document: what the context says it prints, or _Broken
 *   reference_ and broken where the document does not offer it; on its own, _Section_ or _In another
 *   component_, and not broken, since nothing there can judge it.
 *
 * `within` is for a footnote's own editor, whose document is the footnote alone: the component that
 * footnote stands in, whose blocks its references name, and where the footnote's content begins in
 * it. Positions answered are `doc`'s own either way.
 */
export function referencesShown(
  doc: Node,
  context: ReferenceContext | null,
  within?: { readonly component: Node; readonly offset: number },
): readonly ReferenceShown[] {
  const component = within?.component ?? doc;
  const offset = within?.offset ?? 0;
  // Only built where there is a reference to show, which is most components not at all.
  let held: Map<string, Held> | null = null;
  let offered: Map<string, ReferenceTarget> | null = null;
  const shown: ReferenceShown[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'crossReference') return true;
    held ??= identified(component);
    offered ??= new Map(context?.targets.map((each) => [keyOf(each.target), each]));
    const target = node.attrs.target as CrossReferenceTarget;
    const display = node.attrs.display as CrossReferenceDisplay;
    const found = offered.get(keyOf(target));
    if (target.kind === 'block') {
      const own = held.get(target.block);
      if (own === undefined) {
        shown.push({ pos, text: BROKEN_REFERENCE, broken: true });
      } else if (found !== undefined) {
        const relative = own.pos < pos + offset ? 'above' : 'below';
        shown.push({ pos, text: printed(found, display, relative), broken: false });
      } else {
        shown.push({ pos, text: named(own.node), broken: false });
      }
    } else if (context === null) {
      const text = target.kind === 'node' ? kindWord('section') : IN_ANOTHER_COMPONENT;
      shown.push({ pos, text, broken: false });
    } else if (found !== undefined) {
      shown.push({ pos, text: printed(found, display, found.relative), broken: false });
    } else {
      shown.push({ pos, text: BROKEN_REFERENCE, broken: true });
    }
    return false;
  });
  return shown;
}

/**
 * Every node of the component carrying an identifier, by it: a block, a list's item, a table's cell's
 * paragraph, a footnote and its paragraphs - whatever a `block` target could name - but **never a
 * reference**, whose identifier is its own and names nothing a reference could point at. The first
 * holder wins, as the identity plugin keeps only one.
 */
function identified(component: Node): Map<string, Held> {
  const held = new Map<string, Held>();
  component.descendants((node, pos) => {
    const id = node.attrs.id as unknown;
    if (typeof id === 'string' && node.type.name !== 'crossReference' && !held.has(id)) {
      held.set(id, { node, pos });
    }
    return true;
  });
  return held;
}

/** The kind of block a `block` target names, told from the live document. */
function kindOf(node: Node): ReferenceKind {
  switch (node.type.name) {
    case 'tableFigure':
      return 'table';
    case 'figure':
      return 'figure';
    case 'footnote':
      return 'footnote';
    default:
      return 'block';
  }
}

/** The caption node each captioned block holds, by the block's type. */
const CAPTIONS: Readonly<Record<string, string>> = {
  tableFigure: 'tableCaption',
  figure: 'figureCaption',
};

/**
 * A held target with no number known: its kind, and its caption's words where it has any - the text of
 * the caption alone, spaces run together, so a reference or an image inside the caption adds nothing.
 */
function named(node: Node): string {
  const word = kindWord(kindOf(node));
  const words = captionOf(node);
  return words === '' ? word : `${word}: ${words}`;
}

/** A figure's or a table's caption's words, spaces run together; empty for anything else. */
function captionOf(node: Node): string {
  const captionType = CAPTIONS[node.type.name];
  let caption = '';
  node.forEach((child) => {
    if (child.type.name === captionType) caption = child.textContent;
  });
  return caption.replace(/\s+/g, ' ').trim();
}

/**
 * **What a component offers a reference of its own** (ruling R11): every figure, table and footnote
 * it holds, in document order, each as a `block` target by its kind and a figure's or a table's
 * caption - read from the live document, so a table placed a moment ago is offered before any page
 * has numbered it. **No label**: a number is the document's to give, and a component on its own has
 * none; the dialog takes the label from the page's context where the page has numbered the block.
 *
 * `at`, where given, is where the reference would stand in `doc`, and each target is _above_ or
 * _below_ it by position, as `referencesShown` judges a reference already placed; without it, null.
 * A paragraph, a list or a cell is never offered, as XR-A offers none.
 */
export function ownTargets(doc: Node, at?: number): readonly ReferenceTarget[] {
  const targets: ReferenceTarget[] = [];
  doc.descendants((node, pos) => {
    const id = node.attrs.id as unknown;
    const kind = kindOf(node);
    if (typeof id !== 'string' || kind === 'block') return true;
    const caption = captionOf(node);
    targets.push({
      target: { kind: 'block', block: id },
      kind,
      label: null,
      title: caption === '' ? null : caption,
      relative: at === undefined ? null : pos < at ? 'above' : 'below',
    });
    return true;
  });
  return targets;
}

/** A target's key, so a reference finds the context's entry for exactly what it stores. */
const keyOf = (target: CrossReferenceTarget): string => {
  switch (target.kind) {
    case 'block':
      return `block\u{0}${target.block}`;
    case 'component':
      return `component\u{0}${target.component}\u{0}${target.block}`;
    case 'node':
      return `node\u{0}${target.node}`;
  }
};
