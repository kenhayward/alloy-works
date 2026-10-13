/**
 * The addresses a document and its nodes have (structure.md, "Deep links"), after the `#` - the same
 * hash routing the rest of the workspace uses, so an address never reaches the service or a reload's
 * path, and the renderer's relative asset paths are never put under a deep one.
 *
 * **A node's address names its document and itself, both by identifier, and nothing else** (STR-044,
 * STR-046): no depth, no number and no position, so there is nothing in it a reorder could make wrong,
 * and the document in it is what finds the node without a tenant-wide index of nodes.
 */

const DOCUMENTS =
  /^#\/documents(?:\/([0-9a-f-]{36})(?:\/nodes\/([a-z2-7]{26})|\/(access)|\/(publishing)(?:\/requests\/([0-9a-f-]{36}))?|\/baselines\/([0-9a-f-]{36})(?:\/nodes\/([a-z2-7]{26})|\/compare\/(now|[0-9a-f-]{36}))?|\/versions\/([0-9a-f-]{36})(?:\/nodes\/([a-z2-7]{26}))?)?)?$/;

/**
 * What a `#/documents...` address names: the list, one document, one node of one document, one
 * document at its Publishing panel, or the access page of one document.
 */
export type DocumentAddress =
  | { readonly kind: 'documents' }
  | { readonly kind: 'document'; readonly document: string; readonly node: string | null }
  | { readonly kind: 'access'; readonly document: string }
  /**
   * The document opened at its Publishing panel (home.md; the HM plan, HM-G), and a failed request of
   * the reader's shown there.
   */
  | { readonly kind: 'publishing'; readonly document: string; readonly request: string | null }
  /** The document as one of its baselines holds it, and a node in it (STR-047; the BL plan). */
  | {
      readonly kind: 'baseline';
      readonly document: string;
      readonly baseline: string;
      readonly node: string | null;
    }
  /** One version of the document, read only, and a node in it (SCH-058; the SV plan, SV-H). */
  | {
      readonly kind: 'version';
      readonly document: string;
      readonly version: string;
      readonly node: string | null;
    }
  /** A baseline compared with a later one, or with the document now (VER-025; the CP plan). */
  | {
      readonly kind: 'comparison';
      readonly document: string;
      readonly baseline: string;
      readonly against: string;
    };

export function documentAddress(hash: string): DocumentAddress | null {
  const matched = DOCUMENTS.exec(hash);
  if (!matched) return null;
  const [, document, node, access, publishing, request, baseline, pinned, against, version, at] =
    matched;
  if (document === undefined) return { kind: 'documents' };
  if (version !== undefined) return { kind: 'version', document, version, node: at ?? null };
  if (access !== undefined) return { kind: 'access', document };
  if (publishing !== undefined) return { kind: 'publishing', document, request: request ?? null };
  if (baseline !== undefined && against !== undefined) {
    return { kind: 'comparison', document, baseline, against };
  }
  if (baseline !== undefined) return { kind: 'baseline', document, baseline, node: pinned ?? null };
  return { kind: 'document', document, node: node ?? null };
}

/** The address of one version of a document, read only, and a node in it (SCH-058). */
export function documentVersionLink(document: string, version: string, node?: string): string {
  return `#/documents/${document}/versions/${version}${node === undefined ? '' : `/nodes/${node}`}`;
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

/**
 * The address of a document as one of its baselines holds it, or of one node in it (STR-047): "section
 * 4.2 as approved", by identifiers alone, as a node's own address is.
 */
export function baselineLink(document: string, baseline: string, node?: string): string {
  return `#/documents/${document}/baselines/${baseline}${node === undefined ? '' : `/nodes/${node}`}`;
}

/** The address of a baseline compared with a later one, or with the document `now`. */
export function comparisonLink(document: string, baseline: string, against: string): string {
  return `#/documents/${document}/baselines/${baseline}/compare/${against}`;
}

/** The address of a document opened at its Publishing panel, showing a failed request there. */
export function publishingLink(document: string, request?: string): string {
  return `#/documents/${document}/publishing${request === undefined ? '' : `/requests/${request}`}`;
}

/** The address of one node of one document. */
export function nodeLink(document: string, node: string): string {
  return `#/documents/${document}/nodes/${node}`;
}
