import { equationAlternative, inlineNodeSchema } from '@alloy-works/domain';
import type { Node } from 'prosemirror-model';
import type { NodeView } from 'prosemirror-view';

const MATHML = 'http://www.w3.org/1998/Math/MathML';

/** What an equation with no spoken alternative says beside itself (equations 1, ruling R5). */
export const NO_DESCRIPTION = 'No description';

/** What stands in an equation's place where its MathML is not what the reader keeps. */
export const UNSHOWN_EQUATION = 'An equation that cannot be shown';

/**
 * The equation's MathML as elements of `document`, or null where it is not the one form the MathML
 * reader writes (equations 1, ruling R5).
 *
 * **A view is not the place to trust a string.** Everything stored has been judged by the strict
 * reader already, but a node's attributes can be set by any transaction, and what is drawn here goes
 * into the page as live elements. So the reader is asked again, through the stored model's own schema
 * as `insertEquation` asks it - never a rule restated here - and that is what keeps out an event
 * handler, a link, a script and any element that is not MathML. Then the string is parsed **as XML**,
 * which is how the stored form is written (its namespace declared on its root), and never as HTML:
 * `innerHTML` would read it by the HTML parser's rules for foreign content, a second reading of the
 * same bytes. What the parser made must be one `math` element in the MathML namespace, with no parse
 * error anywhere in it - Chromium reports one by putting an element into the document it returns
 * rather than by failing - and only that element is imported into the page.
 */
function mathmlElement(mathml: string, document: Document): Element | null {
  if (!inlineNodeSchema.safeParse({ type: 'equation', mathml }).success) return null;
  const Parser = document.defaultView?.DOMParser ?? DOMParser;
  const parsed = new Parser().parseFromString(mathml, 'application/xml');
  const root = parsed.documentElement;
  if (root.namespaceURI !== MATHML || root.localName !== 'math') return null;
  if (parsed.getElementsByTagNameNS('*', 'parsererror').length > 0) return null;
  return document.importNode(root, true);
}

/**
 * Draws an equation into `holder` - the element its node's `toDOM` makes, which the surface's node
 * view and `renderContent` both start from - replacing the words `toDOM` put there (ruling R5).
 *
 * - **Native MathML**, which Chromium lays out and exposes to assistive technology as maths (CNT-080),
 *   carrying the `alttext` it was stored with. A block is drawn in display style whatever its MathML
 *   says, since standing on its own line is what a block is.
 * - **Named by its alternative on the `math` element itself**, with `aria-label`: `alttext` is poorly
 *   supported as a name by screen readers, and ARIA's name is read by every one of them. The holder
 *   takes no role - a `role="math"` or `role="img"` wrapper would make the MathML beneath it
 *   presentational, hiding its structure from a reader that can walk it (NVDA with MathCAT, for one),
 *   which the DAISY knowledge base warns against for MathML in particular.
 * - **An equation with no alternative is marked**, by a class for the stylesheet and by the words
 *   _No description_ beside it, which a screen reader hears and a reader sees without telling colours
 *   apart (CNT-138). Its MathML is still drawn: the equation is there, only its words are missing.
 * - **A numbered block shows that it is**, by a marker at its end: the number itself is the document's,
 *   as a reference's is, and a component edited on its own has none to show.
 * - **MathML the reader would not keep draws nothing of itself**: the holder says only that an equation
 *   cannot be shown, marked as a missing image is.
 */
export function drawEquation(
  holder: HTMLElement,
  attrs: { readonly mathml: string; readonly numbered?: boolean },
  display: 'inline' | 'block',
): void {
  const document = holder.ownerDocument;
  holder.replaceChildren();
  holder.classList.remove('aw-equation-unshown', 'aw-equation-undescribed');
  const math = mathmlElement(attrs.mathml, document);
  if (math === null) {
    holder.classList.add('aw-equation-unshown');
    holder.textContent = UNSHOWN_EQUATION;
    return;
  }
  if (display === 'block') math.setAttribute('display', 'block');
  const alternative = equationAlternative(attrs.mathml);
  if (alternative !== null) math.setAttribute('aria-label', alternative);
  holder.appendChild(math);
  if (alternative === null) {
    holder.classList.add('aw-equation-undescribed');
    const marker = document.createElement('span');
    marker.className = 'aw-equation-undescribed-marker';
    marker.textContent = NO_DESCRIPTION;
    holder.appendChild(marker);
  }
  if (display === 'block' && attrs.numbered === true) {
    const number = document.createElement('span');
    number.className = 'aw-equation-number';
    number.setAttribute('role', 'img');
    number.setAttribute('aria-label', 'Numbered');
    number.textContent = '(#)';
    holder.appendChild(number);
  }
}

/**
 * An equation on the surface, inline or a block (equations 1, ruling R5): the holder `toDOM` makes,
 * drawn by `drawEquation`, and drawn again only when what it shows changes - its MathML, or a block's
 * numbering; a block's identifier or the LaTeX it was typed as changes nothing on the page.
 *
 * Selected whole, it is outlined by the stylesheet, and `Enter` opens it (`enterEquation`). Everything
 * inside it is the view's own drawing, never content, so a change there is not read back as an edit.
 */
export function equationView(node: Node, document: Document): NodeView {
  let shown = node;
  const display = node.type.name === 'equationBlock' ? 'block' : 'inline';
  const [tag, attrs] = node.type.spec.toDOM!(node) as unknown as [string, Record<string, string>];
  const dom = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) dom.setAttribute(name, value);
  const draw = (from: Node) =>
    drawEquation(
      dom,
      { mathml: from.attrs.mathml as string, numbered: from.attrs.numbered === true },
      display,
    );
  draw(node);
  return {
    dom,
    update(next) {
      if (next.type !== shown.type) return false;
      const same =
        next.attrs.mathml === shown.attrs.mathml && next.attrs.numbered === shown.attrs.numbered;
      shown = next;
      if (!same) draw(next);
      return true;
    },
    selectNode() {
      dom.classList.add('ProseMirror-selectednode');
    },
    deselectNode() {
      dom.classList.remove('ProseMirror-selectednode');
    },
    ignoreMutation: () => true,
  };
}
