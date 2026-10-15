import {
  applyOverrides,
  readContent,
  walkOutline,
  type ContentDocument,
  type OutlineDocument,
  type Override,
} from '@alloy-works/domain';
import type { TenantTransaction } from './tables.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Each of these component versions' content, where it is a version of `component` (the R4 plan,
 * R4-B, R4-C): what an override was made against, and so what it is checked against.
 */
export async function overrideOriginals(
  trx: TenantTransaction,
  wanted: readonly { readonly component: string; readonly version: string }[],
): Promise<Map<string, ContentDocument>> {
  const ids = [...new Set(wanted.map((each) => each.version).filter((id) => UUID.test(id)))];
  const contents = new Map<string, ContentDocument>();
  if (ids.length === 0) return contents;
  const rows = await trx
    .selectFrom('artifact_version')
    .select(['id', 'artifact_id', 'content'])
    .where('id', 'in', ids)
    .where('kind', '=', 'component')
    .execute();
  for (const row of rows) {
    if (!wanted.some((each) => each.version === row.id && each.component === row.artifact_id)) {
      continue;
    }
    const read = readContent(row.content, { artifact: row.artifact_id, version: row.id });
    if (read.ok) contents.set(row.id, read.document);
  }
  return contents;
}

/** Each reference's overrides in an outline, by its node. */
function overridesIn(
  outline: OutlineDocument,
): Map<string, { component: string; overrides: readonly Override[] }> {
  const found = new Map<string, { component: string; overrides: readonly Override[] }>();
  walkOutline(outline.nodes, (node) => {
    if (node.type === 'reference' && node.overrides && node.overrides.length > 0) {
      found.set(node.id, { component: node.component, overrides: node.overrides });
    }
  });
  return found;
}

/**
 * The content each placed component shows in this document, its overrides applied where they stand,
 * and each that is stale, by node and block (REU-011, REU-015; R4-C, R4-D). `contents` is each node's
 * resolved content; a node without overrides is answered as it was.
 */
export async function applyOutlineOverrides(
  trx: TenantTransaction,
  outline: OutlineDocument,
  contents: ReadonlyMap<string, ContentDocument>,
): Promise<{
  readonly contents: Map<string, ContentDocument>;
  readonly stale: readonly { readonly node: string; readonly block: string }[];
}> {
  const overridden = overridesIn(outline);
  const applied = new Map(contents);
  const stale: { node: string; block: string }[] = [];
  if (overridden.size === 0) return { contents: applied, stale };
  const originals = await overrideOriginals(
    trx,
    [...overridden.values()].flatMap(({ component, overrides }) =>
      overrides.map((each) => ({ component, version: each.against })),
    ),
  );
  for (const [node, { overrides }] of overridden) {
    const content = contents.get(node);
    if (!content) continue;
    const result = applyOverrides(content, overrides, originals);
    applied.set(node, result.content);
    for (const block of result.stale) stale.push({ node, block });
  }
  return { contents: applied, stale };
}
