import {
  formsFor,
  kindWord,
  printed,
  targetForms,
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
  /**
   * What a `relative` reference prints for _above_ and _below_, in the layout's own words
   * (cross-references 2, ruling R9). Absent where there is no document, or its layout gives neither -
   * `printed` falls back to the English literal, exactly as before layouts had words of their own.
   */
  readonly words?: { readonly above: string; readonly below: string };
  /**
   * The component being edited, where the host knows it. A `component` target naming it - a reference
   * pasted in from another component keeps the target it had there - is a block of its own, and is
   * shown exactly as a `block` target is, since a publish binds it to the occurrence being read
   * (STR-056). Absent, such a target is shown as another component's.
   */
  readonly component?: string;
}

/** What one reference shows, and where it stands in the document it was read from. */
export interface ReferenceShown {
  readonly pos: number;
  readonly text: string;
  /** Whether its target has gone: drawn apart, and the text says so to a screen reader too. */
  readonly broken: boolean;
  /**
   * Where it asks its target for a form the target has not got (W-N), what the target is called - its
   * kind, and a figure's or a table's caption - so the Reference dialog, opened on it, names the target
   * rather than the words the surface shows in its place. Absent everywhere else.
   */
  readonly named?: string;
  /**
   * Where `named` is, the target the reference is shown from, placed against it (`relative`), so the
   * dialog opened on it offers that target's forms and says what each will print.
   */
  readonly printing?: ReferenceTarget;
}

/** The class a broken reference carries, on the surface and read-only, so it is drawn apart. */
export const BROKEN_CLASS = 'aw-reference-broken';

/**
 * What a reference whose target has gone says, in place of anything it would print - naming what it
 * pointed at as far as the editor can know it (XR-F). A `node` target was a section, and a `component`
 * target is in another component, whatever it is there; a `block` target's kind went with the block,
 * and the stored target names only an identifier, so it says no more than that it is broken.
 */
export const BROKEN_REFERENCE = 'Broken reference';

/** A broken reference to a section, and one to another component: what each pointed at, named. */
export const BROKEN_SECTION_REFERENCE = 'Broken reference to a section';
export const BROKEN_COMPONENT_REFERENCE = 'Broken reference to another component';

/**
 * What a reference shows where it asks its target for a form the target has not got, which the publish
 * would refuse (`cross_reference_form_unavailable`), in words by the cause (W14's W-N): a number of a
 * figure, a table or a block equation the author has marked unnumbered; a number of what never has
 * one; or a title of what has none, a footnote or an equation. Drawn apart, as a broken one is, since
 * the author has to choose another form - never the caption printed in the number's place, which
 * would read wrongly in a sentence written around a number and hide the change from the author.
 */
export function unavailableReference(
  target: ReferenceTarget,
  display: CrossReferenceDisplay,
): string {
  const word = kindWord(target.kind);
  const wantsNumber = display === 'number' || display === 'numberAndTitle';
  const wantsTitle = display === 'title' || display === 'numberAndTitle';
  if (wantsNumber && target.unnumbered) return `${word} not numbered - choose another form`;
  if (wantsTitle && target.titleHoldsEquation) {
    return `${word} title holds an equation - choose another form`;
  }
  if (wantsNumber && !formsFor(target.kind).includes('number')) {
    return `${word} has no number - choose another form`;
  }
  if (wantsTitle) return `${word} has no title - choose another form`;
  return `${word} cannot be shown this way - choose another form`;
}

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
 * - a `component` target naming the component being edited (`context.component`): a block of its own,
 *   shown as a `block` target naming that block is;
 * - a `node` or a `component` target in a document: what the context says it prints, or _Broken
 *   reference to a section_ or _to another component_, and broken, where the document does not offer
 *   it; on its own, _Section_ or _In another component_, and not broken, since nothing there can judge
 *   it.
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
    const stored = node.attrs.target as CrossReferenceTarget;
    const display = node.attrs.display as CrossReferenceDisplay;
    const target: CrossReferenceTarget =
      stored.kind === 'component' && stored.component === context?.component
        ? { kind: 'block', block: stored.block }
        : stored;
    const found = offered.get(keyOf(target));
    if (target.kind === 'block') {
      const own = held.get(target.block);
      if (own === undefined) {
        shown.push({ pos, text: BROKEN_REFERENCE, broken: true });
        return false;
      }
      const relative = own.pos < pos + offset ? 'above' : 'below';
      // The live document decides whether a figure, a table or a block equation is numbered (STR-071,
      // CNT-047): the page's numbering is refetched only for a new version of the document, so it may
      // still number one the author has just marked unnumbered, or still call one unnumbered that has
      // just been numbered again, whose number it does not know yet.
      const printing =
        unnumberedTarget(own.node, target) ?? (found?.unnumbered === true ? undefined : found);
      if (printing !== undefined && !targetForms(printing).includes(display)) {
        shown.push({
          pos,
          text: unavailableReference(printing, display),
          broken: true,
          named: named(own.node),
          printing: { ...printing, relative },
        });
      } else if (printing !== undefined) {
        shown.push({
          pos,
          text: printed(printing, display, relative, context?.words),
          broken: false,
        });
      } else {
        shown.push({ pos, text: named(own.node), broken: false });
      }
    } else if (context === null) {
      const text = target.kind === 'node' ? kindWord('section') : IN_ANOTHER_COMPONENT;
      shown.push({ pos, text, broken: false });
    } else if (found !== undefined && !targetForms(found).includes(display)) {
      // A section, or another component's block, asked for a form it has not got - a number of a
      // figure or a table marked unnumbered, a title of a section whose title holds an equation - which
      // the publish refuses, as for a block of this component (W-N). Offered by the page, so the
      // dialog names it by its own option.
      shown.push({ pos, text: unavailableReference(found, display), broken: true });
    } else if (found !== undefined) {
      shown.push({
        pos,
        text: printed(found, display, found.relative, context?.words),
        broken: false,
      });
    } else {
      const text = target.kind === 'node' ? BROKEN_SECTION_REFERENCE : BROKEN_COMPONENT_REFERENCE;
      shown.push({ pos, text, broken: true });
    }
    return false;
  });
  return shown;
}

/**
 * Every node of the component carrying an identifier, by it: a block, a list's item, a table's cell's
 * paragraph, a footnote and its paragraphs - whatever a `block` target could name - but **never a
 * reference or a binding**, whose identifiers are their own and name nothing a reference could point
 * at (B1-C). The first
 * holder wins, as the identity plugin keeps only one.
 */
function identified(component: Node): Map<string, Held> {
  const held = new Map<string, Held>();
  component.descendants((node, pos) => {
    const id = node.attrs.id as unknown;
    if (
      typeof id === 'string' &&
      node.type.name !== 'crossReference' &&
      node.type.name !== 'binding' &&
      !held.has(id)
    ) {
      held.set(id, { node, pos });
    }
    return true;
  });
  return held;
}

/**
 * A figure, a table or a block equation the live document marks unnumbered, as a target: its kind and
 * a figure's or a table's caption, no label, and `unnumbered`, so `targetForms` offers no number form
 * of it. Undefined for anything else, a numbered one among them.
 */
function unnumberedTarget(node: Node, target: CrossReferenceTarget): ReferenceTarget | undefined {
  const unnumbered =
    node.type.name === 'equationBlock'
      ? node.attrs.numbered !== true
      : CAPTIONS[node.type.name] !== undefined && node.attrs.numbered === false;
  if (!unnumbered) return undefined;
  const caption = captionOf(node);
  return {
    target,
    kind: kindOf(node),
    label: null,
    title: caption === '' ? null : caption,
    relative: null,
    unnumbered: true,
  };
}

/** The kind of block a `block` target names, told from the live document. */
function kindOf(node: Node): ReferenceKind {
  switch (node.type.name) {
    case 'tableFigure':
    case 'boundTable':
      return 'table';
    case 'figure':
      return 'figure';
    case 'footnote':
      return 'footnote';
    // Equations 2, ruling R7: a block equation is its own kind, not `block`, so a reference to one
    // with no known number shows _Equation_ rather than _Paragraph_ (`named`, below).
    case 'equationBlock':
      return 'equation';
    default:
      return 'block';
  }
}

/** The caption node each captioned block holds, by the block's type. */
const CAPTIONS: Readonly<Record<string, string>> = {
  tableFigure: 'tableCaption',
  boundTable: 'tableCaption',
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
 * A paragraph, a list or a cell is never offered, as XR-A offers none. Nor is a block equation the
 * author left unnumbered (equations 2, ruling R7): it has no number, so a page and a position are all
 * that would be left to offer, which `documentTargets` already withholds once the document has one to
 * compare against - offering it here and refusing it there would be an offer this component cannot
 * keep. A figure or a table the author marked unnumbered is offered, by its caption, and says it is
 * unnumbered, so the dialog offers no number form of it (STR-071).
 */
export function ownTargets(doc: Node, at?: number): readonly ReferenceTarget[] {
  const targets: ReferenceTarget[] = [];
  doc.descendants((node, pos) => {
    const id = node.attrs.id as unknown;
    const kind = kindOf(node);
    if (typeof id !== 'string' || kind === 'block') return true;
    if (kind === 'equation' && node.attrs.numbered !== true) return true;
    const caption = captionOf(node);
    targets.push({
      target: { kind: 'block', block: id },
      kind,
      label: null,
      title: caption === '' ? null : caption,
      relative: at === undefined ? null : pos < at ? 'above' : 'below',
      // A figure or a table the author marked unnumbered (STR-071): offered by its caption, which is
      // what a reference to it prints, and never in a number form.
      ...(node.attrs.numbered === false && kind !== 'equation'
        ? { unnumbered: true as const }
        : {}),
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
