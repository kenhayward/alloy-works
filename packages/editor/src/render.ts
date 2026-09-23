import { parseContentDocument, type ContentDocument } from '@alloy-works/domain';
import { DOMSerializer, type Node } from 'prosemirror-model';

import { drawEquation } from './equationView.js';
import { toEditor } from './mapping.js';
import { BROKEN_CLASS, referencesShown, type ReferenceContext } from './referenceText.js';
import { editorSchema } from './schema.js';

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
 */
export function renderContent(
  content: unknown,
  document: Document,
  context: ReferenceContext | null = null,
): HTMLElement | DocumentFragment | null {
  let parsed: ContentDocument;
  try {
    parsed = parseContentDocument(content);
  } catch {
    return null;
  }
  const opened = toEditor(parsed);
  if (!opened.editable) return null;
  const rendered = DOMSerializer.fromSchema(editorSchema).serializeFragment(opened.doc.content, {
    document,
  });
  drawReferences(rendered, referencesShown(opened.doc, context));
  drawEquations(rendered, opened.doc);
  return rendered;
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
