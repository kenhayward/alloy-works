import type { ContentDocument } from '../content/model/document.js';
import { parseOutlineDocument, type OutlineDocument, type OutlineNode } from './outline.js';
import type { Override } from './overrides.js';

/** The most components one document copy makes, as a placement makes at most `PLACE_MAX` (RM-H). */
export const COPY_MAX = 200;

/** What a document copy does with its components (RM-G): reuse them, copy its own, or copy them all. */
export type CopyChoice = 'reuse' | 'own' | 'all';

/**
 * Where a component a document places stands, as a copy decides it (RM-G, RM-K; REU-057): placed in
 * no other document, or in others; or fixed, never copied - its template requires and shares it, it is
 * archived or deleted, or the caller may not read it.
 */
export type CopyPlacement = 'only' | 'shared' | 'required' | 'kept' | 'unreadable';

/** A component a document places, as a copy decides it. */
export interface PlacedComponent {
  readonly component: string;
  readonly placed: CopyPlacement;
}

/** A component set otherwise than its starting point (REU-057). */
export interface CopyException {
  readonly component: string;
  readonly as: 'copy' | 'reuse';
}

/** Whether no choice copies a component placed so (RM-K; REU-057). */
export const isFixed = (placed: CopyPlacement): boolean =>
  placed === 'required' || placed === 'kept' || placed === 'unreadable';

/** Whether a starting point copies a component placed so, before any exception. */
export function startsCopied(choice: CopyChoice, placed: CopyPlacement): boolean {
  if (isFixed(placed) || choice === 'reuse') return false;
  return choice === 'all' || placed === 'only';
}

/**
 * The components a choice and its exceptions copy, in the order placed (REU-057); or the first
 * exception refused: one naming a component not placed, or copying a fixed one.
 */
export function chosenCopies(
  choice: CopyChoice,
  placed: readonly PlacedComponent[],
  exceptions: readonly CopyException[] = [],
):
  | { readonly copied: string[] }
  | { readonly refused: 'unknown' | 'fixed'; readonly component: string } {
  const by = new Map(placed.map((each) => [each.component, each.placed]));
  const set = new Map<string, 'copy' | 'reuse'>();
  for (const each of exceptions) {
    const at = by.get(each.component);
    if (at === undefined) return { refused: 'unknown', component: each.component };
    if (each.as === 'copy' && isFixed(at)) return { refused: 'fixed', component: each.component };
    set.set(each.component, each.as);
  }
  return {
    copied: placed
      .filter((each) =>
        set.has(each.component)
          ? set.get(each.component) === 'copy'
          : startsCopied(choice, each.placed),
      )
      .map((each) => each.component),
  };
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
  const copiedFor = (node: OutlineNode & { type: 'reference' }) =>
    node.origin === undefined || copies.has(node.component)
      ? replaced.get(node.component)
      : undefined;
  // A placed group any of whose members is copied pins what the group never did: the whole run
  // becomes plain references, so no later take mistakes it for the group (the CG final review).
  const broken = new Set<string>();
  const find = (node: OutlineNode): void => {
    if (node.type === 'reference' && node.group !== undefined && copiedFor(node) !== undefined) {
      broken.add(node.group.placement);
    }
    node.children.forEach(find);
  };
  outline.nodes.forEach(find);
  const ungrouped = (node: OutlineNode & { type: 'reference' }) => {
    if (node.group === undefined || !broken.has(node.group.placement)) return node;
    const plain: OutlineNode & { type: 'reference' } = { ...node };
    delete (plain as { group?: unknown }).group;
    return plain;
  };
  const copy = (node: OutlineNode): OutlineNode => {
    const children = node.children.map(copy);
    if (node.type === 'section') return { ...node, children };
    const copied = copiedFor(node);
    if (copied === undefined) return { ...ungrouped(node), children };
    repointed += 1;
    if (node.mode.kind === 'approved') approvedToLatest += 1;
    const mode =
      node.mode.kind === 'pinned'
        ? { kind: 'pinned' as const, version: copied.version }
        : { kind: 'latest' as const };
    const { overrides: was, ...rest } = ungrouped(node);
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
