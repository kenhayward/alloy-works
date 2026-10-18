import {
  parseContentDocument,
  selectOutline,
  walkOutline,
  type OutlineDocument,
  type OutlineNode,
  type Prompt,
  type ResolvedContext,
  type ResolvedPart,
} from '@alloy-works/domain';
import { readDocument } from './documents.js';
import { resolveOccurrences } from './publishing.js';
import type { TenantTransaction } from './tables.js';
import { neighbours } from './traversal.js';
import { latestVersion, versionContents } from './versions.js';

/**
 * A prompt's context resolved (generation.md, "The context"; the G4 plan, G4-H): what its declaration
 * names, read as the person running it, so a part they may not read is absent, never flagged
 * (GEN-058); the parts by version, and the parameters' values, nothing else (GEN-003).
 */

/** The most parts one context resolves to: past it, the run is refused, never cut to fit. */
export const CONTEXT_PARTS_MOST = 200;

export type ContextAnswer =
  | {
      readonly answer: 'resolved';
      readonly context: ResolvedContext;
      /** What the run records it read (GEN-057): each part by artifact, version and block. */
      readonly record: readonly (
        | {
            readonly component: string;
            readonly version: string;
            readonly blocks: readonly string[];
          }
        | { readonly parameter: string; readonly value: unknown }
      )[];
    }
  /** The node is no part of the document the runner may read. */
  | { readonly answer: 'part.missing' }
  /** Every source it declares resolved to nothing (GEN-059). */
  | { readonly answer: 'context.empty' }
  /** More parts than a context takes, or related ones past what a traversal answers (GEN-059). */
  | { readonly answer: 'context.too_many'; readonly parts: number };

type Node = OutlineNode;

/** Each reference node's nearest section above it, or null at the top level. */
function sectionsOf(outline: OutlineDocument): ReadonlyMap<string, Node | null> {
  const above = new Map<string, Node | null>();
  const visit = (nodes: readonly Node[], section: Node | null) => {
    for (const node of nodes) {
      above.set(node.id, section);
      visit(node.children as readonly Node[], node.type === 'section' ? node : section);
    }
  };
  visit(outline.nodes as readonly Node[], null);
  return above;
}

/** A metadata value holds a field source's value: the same, or a list holding it. */
const holds = (held: unknown, value: unknown): boolean =>
  held === value || (Array.isArray(held) && held.includes(value));

/**
 * Resolves a prompt's declared context for its run on `node` of `documentId`, as `principal` reads it
 * now. The caller has decided they may read the document.
 */
export async function resolveContext(
  trx: TenantTransaction,
  input: {
    readonly principal: string;
    readonly documentId: string;
    readonly node: string;
    readonly prompt: Prompt;
  },
): Promise<ContextAnswer> {
  const stored = await readDocument(trx, input.documentId);
  if (!stored) return { answer: 'part.missing' };
  const whole = stored.version.content as OutlineDocument;
  // The document as it is read, its profile's exclusions applied (R6-B): nothing excluded is context.
  const outline = selectOutline(whole, whole.profile?.values ?? {}).outline;
  const resolved = await resolveOccurrences(trx, outline, input.principal);
  const readable = new Map<string, { component: string; version: string }>();
  for (const each of resolved) {
    if (each.outcome === 'resolved') {
      readable.set(each.node, { component: each.component, version: each.version });
    }
  }
  const at = readable.get(input.node);
  if (at === undefined) return { answer: 'part.missing' };

  // Which nodes each source names, the part first.
  const nodes = new Set<string>([input.node]);
  const sections = sectionsOf(outline);
  const extra: { component: string; version: string }[] = [];
  // What each source found: the run is refused only where every one found nothing (GEN-059).
  let found = 0;
  for (const source of input.prompt.context) {
    if (source.source === 'outline') {
      // The part is in every outline source: what the prompt writes is always read.
      found += 1;
      if (source.scope === 'part') continue;
      const section = sections.get(input.node) ?? null;
      const within =
        source.scope === 'document' || section === null
          ? (outline.nodes as readonly Node[])
          : (section.children as readonly Node[]);
      walkOutline(within, (node) => {
        if (node.type === 'reference' && readable.has(node.id)) nodes.add(node.id);
      });
    } else if (source.source === 'related') {
      const related = await neighbours(trx, input.principal, at.component, {
        type: source.type,
        direction: source.direction,
      });
      if (related.more) return { answer: 'context.too_many', parts: CONTEXT_PARTS_MOST + 1 };
      for (const each of related.items) {
        if (each.other.kind !== 'component') continue;
        const pinned =
          each.direction === 'out' ? each.relationship.to.version : each.relationship.from.version;
        const version = pinned ?? (await latestVersion(trx, each.other.id))?.id;
        if (version !== undefined) {
          extra.push({ component: each.other.id, version });
          found += 1;
        }
      }
    } else if (source.source === 'field') {
      const versions = [...readable.values()].map((each) => each.version);
      const rows = await trx
        .selectFrom('artifact_version')
        .select(['id', 'metadata_values'])
        .where('id', 'in', versions)
        .execute();
      const matching = new Set(
        rows
          .filter((row) =>
            holds((row.metadata_values as Record<string, unknown>)[source.field], source.value),
          )
          .map((row) => row.id),
      );
      for (const [node, each] of readable) {
        if (matching.has(each.version)) {
          nodes.add(node);
          found += 1;
        }
      }
    }
  }

  // Each part once, by component: the outline's first, then the related, in the order found.
  const chosen: { component: string; version: string }[] = [];
  const seen = new Set<string>();
  const take = (each: { component: string; version: string }) => {
    if (seen.has(each.component)) return;
    seen.add(each.component);
    chosen.push(each);
  };
  take(at);
  walkOutline(outline.nodes as readonly Node[], (node) => {
    if (nodes.has(node.id)) take(readable.get(node.id)!);
  });
  for (const each of extra) take(each);
  if (chosen.length > CONTEXT_PARTS_MOST) {
    return { answer: 'context.too_many', parts: chosen.length };
  }

  const contents = await versionContents(
    trx,
    chosen.map((each) => each.version),
  );
  const parts: ResolvedPart[] = [];
  for (const each of chosen) {
    const read = contents.get(each.version);
    if (!read) continue;
    parts.push({
      component: each.component,
      version: each.version,
      number: `${read.revision}.${read.version}`,
      content: parseContentDocument(read.content),
    });
  }
  const named = input.prompt.context.flatMap((each) =>
    each.source === 'parameters' ? each.names : [],
  );
  const parameters: Record<string, string | boolean | readonly (string | boolean)[]> = {};
  for (const name of named) {
    const value = stored.version.parameters[name];
    if (value !== undefined) parameters[name] = value as string | boolean | (string | boolean)[];
  }
  if (found + Object.keys(parameters).length === 0) return { answer: 'context.empty' };
  return {
    answer: 'resolved',
    context: { part: parts[0]!, parts, parameters },
    record: [
      ...parts.map((each) => ({
        component: each.component,
        version: each.version,
        blocks: each.content.content.map((block) => block.id),
      })),
      ...Object.entries(parameters).map(([parameter, value]) => ({ parameter, value })),
    ],
  };
}
