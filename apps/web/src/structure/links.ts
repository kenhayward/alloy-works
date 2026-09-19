/**
 * The addresses a document and its nodes have (structure.md, "Deep links"), after the `#` - the same
 * hash routing the rest of the workspace uses, so an address never reaches the service or a reload's
 * path, and the renderer's relative asset paths are never put under a deep one.
 *
 * **A node's address names its document and itself, both by identifier, and nothing else** (STR-044,
 * STR-046): no depth, no number and no position, so there is nothing in it a reorder could make wrong,
 * and the document in it is what finds the node without a tenant-wide index of nodes.
 */

const DOCUMENTS = /^#\/documents(?:\/([0-9a-f-]{36})(?:\/nodes\/([a-z2-7]{26}))?)?$/;

/** What a `#/documents...` address names: the list, one document, or one node of one document. */
export type DocumentAddress =
  | { readonly kind: 'documents' }
  | { readonly kind: 'document'; readonly document: string; readonly node: string | null };

export function documentAddress(hash: string): DocumentAddress | null {
  const matched = DOCUMENTS.exec(hash);
  if (!matched) return null;
  const [, document, node] = matched;
  if (document === undefined) return { kind: 'documents' };
  return { kind: 'document', document, node: node ?? null };
}

/** The address of a document itself: its outline's root (STR-054). */
export function documentLink(document: string): string {
  return `#/documents/${document}`;
}

/** The address of one node of one document. */
export function nodeLink(document: string, node: string): string {
  return `#/documents/${document}/nodes/${node}`;
}
