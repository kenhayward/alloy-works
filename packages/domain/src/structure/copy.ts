import type { ContentDocument } from '../content/model/document.js';
import { parseOutlineDocument, type OutlineDocument, type OutlineNode } from './outline.js';
import type { Override } from './overrides.js';

/** The most components one document copy makes, as a placement makes at most `PLACE_MAX` (RM-H). */
export const COPY_MAX = 200;

/** What a document copy does with its components (RM-G): reuse them, copy its own, or copy them all. */
export type CopyChoice = 'reuse' | 'own' | 'all';

/** A component a document places, as a copy decides it (RM-G, RM-K). */
export interface PlacedComponent {
  readonly component: string;
  /** Placed in no other document. */
  readonly own: boolean;
  /** Deleted or archived: reused under any choice. */
  readonly kept: boolean;
}

/** The components a choice copies, in the order given; never one deleted or archived (RM-K). */
export function chosenCopies(choice: CopyChoice, placed: readonly PlacedComponent[]): string[] {
  if (choice === 'reuse') return [];
  return placed
    .filter((each) => !each.kept && (choice === 'all' || each.own))
    .map((each) => each.component);
}

/** A component's copy, as the outline's copy repoints to it (RM-J). */
export interface CopiedComponent {
  readonly component: string;
  /** The copy's one version. */
  readonly version: string;
  /** Whether an override of the original still stands at the copy's version: its block unchanged. */
  readonly keeps: (override: Override) => boolean;
}

/** What a copy of an outline changed, counted for the caller to report. */
export interface CopyCounts {
  readonly repointed: number;
  readonly approvedToLatest: number;
  readonly overridesRepointed: number;
  readonly overridesDropped: number;
}

/**
 * **A document's outline, copied** (RM-I, RM-J): every node's identity, section and value kept, so a
 * `node` cross-reference and a section title resolve in the copy unchanged; each reference to a
 * copied component repointed to the copy, `pinned` to its version, `latest` kept and `approved` made
 * `latest`; each override repointed where its block is unchanged there, else dropped. A reference the
 * template requires (`origin`) is never repointed (RM-K), unless its component is one of `copies`, a copy
 * the template made for this document and so its own (REU-057; the ND plan, ND-G). Pure; the outline
 * given is not changed.
 */
export function copyOutline(
  outline: OutlineDocument,
  replaced: ReadonlyMap<string, CopiedComponent>,
  copies: ReadonlySet<string> = new Set(),
): { readonly outline: OutlineDocument; readonly counts: CopyCounts } {
  let repointed = 0;
  let approvedToLatest = 0;
  let overridesRepointed = 0;
  let overridesDropped = 0;
  const copy = (node: OutlineNode): OutlineNode => {
    const children = node.children.map(copy);
    if (node.type === 'section') return { ...node, children };
    const copied =
      node.origin === undefined || copies.has(node.component)
        ? replaced.get(node.component)
        : undefined;
    if (copied === undefined) return { ...node, children };
    repointed += 1;
    if (node.mode.kind === 'approved') approvedToLatest += 1;
    const mode =
      node.mode.kind === 'pinned'
        ? { kind: 'pinned' as const, version: copied.version }
        : { kind: 'latest' as const };
    const { overrides: was, ...rest } = node;
    const overrides = (was ?? []).flatMap((each) => {
      if (copied.keeps(each)) {
        overridesRepointed += 1;
        return [{ ...each, against: copied.version }];
      }
      overridesDropped += 1;
      return [];
    });
    return {
      ...rest,
      component: copied.component,
      mode,
      ...(overrides.length > 0 ? { overrides } : {}),
      children,
    };
  };
  return {
    outline: parseOutlineDocument({ ...outline, nodes: outline.nodes.map(copy) }),
    counts: { repointed, approvedToLatest, overridesRepointed, overridesDropped },
  };
}

/**
 * A copied component's content, each `component` cross-reference to another component copied with it
 * remapped to that copy (RM-J); the rest as it was. Pure; the content given is not changed.
 */
export function copyContent(
  content: ContentDocument,
  copies: ReadonlyMap<string, string>,
): { readonly content: ContentDocument; readonly remapped: number } {
  let remapped = 0;
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (typeof value !== 'object' || value === null) return value;
    const node = value as Record<string, unknown>;
    const entries = Object.entries(node).map(([key, each]) => [key, walk(each)] as const);
    const walked = Object.fromEntries(entries) as Record<string, unknown>;
    const target = walked['target'] as { kind?: unknown; component?: unknown } | undefined;
    if (
      walked['type'] === 'crossReference' &&
      target?.kind === 'component' &&
      typeof target.component === 'string' &&
      copies.has(target.component)
    ) {
      remapped += 1;
      walked['target'] = { ...target, component: copies.get(target.component) };
    }
    return walked;
  };
  return {
    content: { ...content, content: walk(content.content) as ContentDocument['content'] },
    remapped,
  };
}
