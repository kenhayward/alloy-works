import { parseContentDocument, type ContentDocument } from '@alloy-works/domain';
import { DOMSerializer, type Node, type Slice } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

import {
  ALONE_CLASS,
  bindingsShown,
  FAILED_CLASS,
  type BindingContext,
  type BindingShown,
} from './bindings.js';
import { fillBinding } from './bindingView.js';
import { drawEquation } from './equationView.js';
import { toEditor } from './mapping.js';
import { BROKEN_CLASS, referencesShown, type ReferenceContext } from './referenceText.js';
import { editorSchema } from './schema.js';
import { drawPlaces } from './places.js';

/**
 * A component's content as markup, to be read and not edited: through the same mapping and schema
 * the editor opens it with, and ProseMirror's own serializer, so a component shown in a document's
 * text looks as it does when it is open - but with no view, no plugins and no state, which is what
 * lets a document show a hundred of them (interface slice 9). `null` for content that does not read
 * as a content document, or that holds what the editor cannot show yet. Browser code, like the view:
 * the document is the caller's.
 *
 * `context` is the document the component is shown in, as the surface's is (cross-references 1,
 * ruling R12): each reference shows what it will print there, and on its own - no context - what the
 * component alone can say of it.
 *
 * `bindings` is where its bindings are shown, as the surface's is (the B1 plan, B1-D): each shows the
 * value the document holds, or why it has none, or on its own what it asks for (`drawBindings`).
 */
export function renderContent(
  content: unknown,
  document: Document,
  context: ReferenceContext | null = null,
  bindings: BindingContext | null = null,
): HTMLElement | DocumentFragment | null {
  let parsed: ContentDocument;
  try {
    parsed = parseContentDocument(content);
  } catch {
    return null;
  }
  // A document the editor's schema cannot build is one it cannot show, never a page that crashes.
  let opened: ReturnType<typeof toEditor>;
  try {
    opened = toEditor(parsed);
  } catch {
    return null;
  }
  if (!opened.editable) return null;
  const rendered = DOMSerializer.fromSchema(editorSchema).serializeFragment(opened.doc.content, {
    document,
  });
  drawReferences(rendered, referencesShown(opened.doc, context));
  drawBindings(rendered, bindingsShown(opened.doc, bindings), bindings);
  drawEquations(rendered, opened.doc);
  drawImages(rendered);
  drawPlaces(rendered, opened.doc);
  return rendered;
}

/**
 * Each image in a line in a holder of its own, as the surface's `imageView` draws it, so a document's
 * text and the surface cannot draw one differently: the theme holds the image's line open by the
 * holder, as the published line is (issue #331). `toDOM` is the bare image, which a copy sees.
 */
function drawImages(rendered: HTMLElement | DocumentFragment): void {
  rendered.querySelectorAll<HTMLElement>('img.aw-inline-image').forEach((image) => {
    if (image.parentElement?.classList.contains('aw-inline-image-holder')) return;
    const holder = image.ownerDocument.createElement('span');
    holder.className = 'aw-inline-image-holder';
    image.replaceWith(holder);
    holder.append(image);
  });
}

/**
 * Each equation as the surface draws it (equations 1, ruling R5): native MathML, a block in display
 * style with its numbering marked, and one with no alternative marked - by the node view's own
 * `drawEquation`, so a document's text and the surface cannot draw one differently. `toDOM` can put
 * only its words in the page, having no document to make elements in. The serializer writes the
 * holders in the order `descendants` meets the nodes in, a footnote's text where its element stands,
 * as it does references.
 */
function drawEquations(rendered: HTMLElement | DocumentFragment, doc: Node): void {
  const holders = rendered.querySelectorAll<HTMLElement>('[data-equation], [data-equation-block]');
  let index = 0;
  doc.descendants((node) => {
    if (node.type.name !== 'equation' && node.type.name !== 'equationBlock') return true;
    const holder = holders[index];
    index += 1;
    if (holder !== undefined) {
      drawEquation(
        holder,
        { mathml: node.attrs.mathml as string, numbered: node.attrs.numbered === true },
        node.type.name === 'equationBlock' ? 'block' : 'inline',
      );
    }
    return false;
  });
}

/**
 * Each cross-reference's text, as the surface draws it (cross-references 1, ruling R12): what it will
 * print in the document `context` describes, or its kind and caption where there is none, and _Broken
 * reference_, drawn apart, where its target has gone. `toDOM` can say only what the node alone tells
 * it. The serializer writes a node's content where its own element stands, a footnote's text
 * included, so the spans come in the order `referencesShown` walks the document in. The surface's
 * copy fills the HTML it writes the same way (`view.ts`).
 */
export function drawReferences(
  rendered: HTMLElement | DocumentFragment,
  shown: readonly { readonly text: string; readonly broken: boolean }[],
): void {
  const spans = rendered.querySelectorAll('span[data-reference]');
  shown.forEach(({ text, broken }, index) => {
    const span = spans[index];
    if (span === undefined) return;
    span.textContent = text;
    if (broken) span.classList.add(BROKEN_CLASS);
  });
}

/**
 * Each binding as the surface draws it (the B1 plan, B1-D, B1-L): what it shows, and the words a
 * screen reader is told after it, by the node view's own `fillBinding`. **One the document holds a
 * resolution for is a `<button type="button">`** in the tab order, styled as the text it stands in,
 * carrying `data-binding` - its identifier - and `data-node` - the occurrence, where the context
 * names it - so the page opens its provenance from a click or Enter (DAT-041). Every other is the
 * schema's span, filled. The serializer writes the spans in the order `bindingsShown` walks the
 * document in, a footnote's text included.
 */
export function drawBindings(
  rendered: HTMLElement | DocumentFragment,
  shown: readonly BindingShown[],
  context: BindingContext | null,
): void {
  const spans = rendered.querySelectorAll<HTMLElement>('span[data-binding]');
  shown.forEach((each, index) => {
    const span = spans[index];
    if (span === undefined) return;
    let element: HTMLElement = span;
    if (each.resolved) {
      element = span.ownerDocument.createElement('button');
      element.setAttribute('type', 'button');
      element.className = span.className;
      if (context?.kind === 'document' && context.node !== undefined) {
        element.dataset.node = context.node;
      }
      span.replaceWith(element);
    }
    element.dataset.binding = each.id ?? '';
    if (each.failed) element.classList.add(FAILED_CLASS);
    if (context?.kind === 'alone') element.classList.add(ALONE_CLASS);
    fillBinding(element, each);
  });
}

/**
 * **What a copy writes for another application** (cross-references 1; the B1 plan, B1-D): the slice as
 * HTML, ProseMirror's own serialisation, and as plain text, with each reference and each binding the
 * slice holds - `references` and `bindings`, in document order - filled with the words it shows, its
 * words alone, where the node would otherwise write `toDOM`'s, or nothing. The surface's copy and a
 * footnote's own editor's write by it.
 */
export function copiedAsShown(
  view: EditorView,
  slice: Slice,
  references: readonly { readonly text: string; readonly broken: boolean }[],
  bindings: readonly BindingShown[],
): { readonly html: string; readonly text: string } {
  const { dom } = view.serializeForClipboard(slice);
  drawReferences(dom, references);
  drawBindings(
    dom,
    bindings.map((each) => ({ ...each, hidden: '', marker: null, resolved: false })),
    null,
  );
  const words = references.map((each) => each.text);
  const values = bindings.map((each) => each.text);
  const text = slice.content.textBetween(0, slice.content.size, '\n\n', (leaf) =>
    leaf.type.name === 'crossReference'
      ? (words.shift() ?? '')
      : leaf.type.name === 'binding'
        ? (values.shift() ?? '')
        : (leaf.type.spec.leafText?.(leaf) ?? ''),
  );
  return { html: dom.innerHTML, text };
}
