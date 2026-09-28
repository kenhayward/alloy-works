/**
 * The addresses a document and its nodes have (structure.md, "Deep links"), after the `#` - the same
 * hash routing the rest of the workspace uses, so an address never reaches the service or a reload's
 * path, and the renderer's relative asset paths are never put under a deep one.
 *
 * **A node's address names its document and itself, both by identifier, and nothing else** (STR-044,
 * STR-046): no depth, no number and no position, so there is nothing in it a reorder could make wrong,
 * and the document in it is what finds the node without a tenant-wide index of nodes.
 */

const DOCUMENTS = /^#\/documents(?:\/([0-9a-f-]{36})(?:\/nodes\/([a-z2-7]{26})|\/(access))?)?$/;

/**
 * What a `#/documents...` address names: the list, one document, one node of one document, or the
 * access page of one document.
 */
export type DocumentAddress =
  | { readonly kind: 'documents' }
  | { readonly kind: 'document'; readonly document: string; readonly node: string | null }
  | { readonly kind: 'access'; readonly document: string };

export function documentAddress(hash: string): DocumentAddress | null {
  const matched = DOCUMENTS.exec(hash);
  if (!matched) return null;
  const [, document, node, access] = matched;
  if (document === undefined) return { kind: 'documents' };
  if (access !== undefined) return { kind: 'access', document };
  return { kind: 'document', document, node: node ?? null };
}

/** The address of a document's access page (access.md, GP-E). */
export function documentAccessLink(document: string): string {
  return `#/documents/${document}/access`;
}

const TEMPLATE_ACCESS = /^#\/templates\/([0-9a-f-]{36})\/access$/;

/**
 * The template whose access page a `#/templates/<id>/access` address names, or null. No page shows a
 * template on its own yet, so its access page is reached from its row in Templates.
 */
export function templateAccessAddress(hash: string): string | null {
  return TEMPLATE_ACCESS.exec(hash)?.[1] ?? null;
}

/** The address of a template's access page. */
export function templateAccessLink(template: string): string {
  return `#/templates/${template}/access`;
}

/** The address of a document itself: its outline's root (STR-054). */
export function documentLink(document: string): string {
  return `#/documents/${document}`;
}

/** The address of one node of one document. */
export function nodeLink(document: string, node: string): string {
  return `#/documents/${document}/nodes/${node}`;
}
