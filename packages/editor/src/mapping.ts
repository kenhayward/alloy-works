import { parseContentDocument, type BlockNode, type ContentDocument } from '@alloy-works/domain';
import type { Node } from 'prosemirror-model';

import { editorSchema } from './schema.js';

/** A stored document opened for editing, or the names of what this editor cannot yet change. */
export type Opened =
  | { readonly editable: true; readonly doc: Node }
  | { readonly editable: false; readonly unsupported: readonly string[] };

/** Every node type and mark in the blocks that the slice's schema has no counterpart for, once each. */
function unsupportedIn(blocks: readonly BlockNode[]): string[] {
  const found = new Set<string>();
  for (const block of blocks) {
    if (block.type !== 'paragraph') {
      found.add(block.type);
      continue;
    }
    for (const inline of block.content) {
      if (inline.type !== 'text') found.add(inline.type);
      else for (const mark of inline.marks) found.add(`mark:${mark.type}`);
    }
  }
  return [...found];
}

/**
 * The stored document as the editor holds it. Total over what it accepts and refuses the rest by name,
 * so opening never loses anything: a component holding a list, an equation or a mark opens read-only,
 * saying why, rather than being edited into something without them.
 */
export function toEditor(document: ContentDocument): Opened {
  const unsupported = unsupportedIn(document.content);
  if (unsupported.length > 0) return { editable: false, unsupported };
  const paragraphs = document.content.map((block) => {
    const paragraph = block as Extract<BlockNode, { type: 'paragraph' }>;
    const text = paragraph.content
      .map((inline) => (inline.type === 'text' ? inline.value : ''))
      .join('');
    return editorSchema.node(
      'paragraph',
      { id: paragraph.id, style: paragraph.style },
      text === '' ? [] : [editorSchema.text(text)],
    );
  });
  return {
    editable: true,
    doc: editorSchema.node(
      'doc',
      { title: document.title, language: document.language, direction: document.direction },
      paragraphs,
    ),
  };
}

/**
 * The editor's document as the stored model holds it, through `parseContentDocument` - so what the
 * renderer sends has already met every rule the service will apply again (component-editor.md,
 * "Invariants the editor holds"). A block with no identifier is refused here, and never reaches storage.
 */
export function fromEditor(doc: Node): ContentDocument {
  const content: unknown[] = [];
  doc.forEach((paragraph, _offset, index) => {
    const id: unknown = paragraph.attrs.id;
    if (typeof id !== 'string') throw new Error(`Block ${index} has no identifier`);
    content.push({
      type: 'paragraph',
      id,
      style: paragraph.attrs.style as string,
      content:
        paragraph.textContent === ''
          ? []
          : [{ type: 'text', value: paragraph.textContent, marks: [] }],
    });
  });
  return parseContentDocument({
    schemaVersion: 1,
    title: doc.attrs.title as string,
    language: doc.attrs.language as string,
    direction: doc.attrs.direction as string,
    content,
  });
}
