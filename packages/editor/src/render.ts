import { parseContentDocument, type ContentDocument } from '@alloy-works/domain';
import { DOMSerializer } from 'prosemirror-model';

import { toEditor } from './mapping.js';
import { editorSchema } from './schema.js';

/**
 * A component's content as markup, to be read and not edited: through the same mapping and schema
 * the editor opens it with, and ProseMirror's own serializer, so a component shown in a document's
 * text looks as it does when it is open - but with no view, no plugins and no state, which is what
 * lets a document show a hundred of them (interface slice 9). `null` for content that does not read
 * as a content document, or that holds what the editor cannot show yet. Browser code, like the view:
 * the document is the caller's.
 */
export function renderContent(
  content: unknown,
  document: Document,
): HTMLElement | DocumentFragment | null {
  let parsed: ContentDocument;
  try {
    parsed = parseContentDocument(content);
  } catch {
    return null;
  }
  const opened = toEditor(parsed);
  if (!opened.editable) return null;
  return DOMSerializer.fromSchema(editorSchema).serializeFragment(opened.doc.content, { document });
}
